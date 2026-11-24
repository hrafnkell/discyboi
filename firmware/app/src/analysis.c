/*
 * Throw analysis on a frozen capture. Preliminary and deliberately simple:
 *
 * 1. Find the calm stretch before the pull: from the first to the last 100 ms window with
 *    |a| ~ 1 g and little rotation. The accelerometer averaged over it, with the gyro tracking
 *    the rotation, defines "up" (see find_ref). If nothing is calm, the calmest 100 ms is used
 *    and the result is flagged as approximate.
 * 2. Integrate the gyro to release to track orientation (when the gyro saturates on z, the
 *    spin rate comes from the rim/centre centripetal difference instead).
 * 3. From the end of the calm stretch, rotate the centre accelerometer into the world frame,
 *    remove gravity and integrate to get the release velocity.
 * 4. At release: disc normal + velocity -> hyzer, nose and launch angles.
 *
 * Heading about the vertical axis is unknown (no magnetometer) but is not needed: all angles
 * are relative to the velocity direction. Integration drift over the ~1-2 s window is the main
 * error source; raw captures can be downloaded to refine this offline.
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <zephyr/logging/log.h>

#include "discy.h"

LOG_MODULE_REGISTER(analysis, LOG_LEVEL_INF);

#define G0           9.80665f
#define DEG          (180.0f / 3.14159265f)
#define DT           (1.0f / IMU_ACTIVE_HZ)
#define STILL_N      (IMU_ACTIVE_HZ / 10)  /* 100 ms */
#define STILL_MAX_DPS 40.0f
#define SPIN_AVG_N   (IMU_ACTIVE_HZ / 50)  /* 20 ms after release */

struct quat {
	float w, x, y, z;
};

static struct quat qmul(struct quat a, struct quat b)
{
	return (struct quat){
		a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
		a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
	};
}

static void qnorm(struct quat *q)
{
	float n = sqrtf(q->w * q->w + q->x * q->x + q->y * q->y + q->z * q->z);

	q->w /= n; q->x /= n; q->y /= n; q->z /= n;
}

/* Rotate v from the sensor frame to the world frame: q v q* */
static void qrot(struct quat q, const float v[3], float out[3])
{
	struct quat p = {0, v[0], v[1], v[2]};
	struct quat c = {q.w, -q.x, -q.y, -q.z};
	struct quat r = qmul(qmul(q, p), c);

	out[0] = r.x; out[1] = r.y; out[2] = r.z;
}

/* Rotation taking unit vector a onto +z. */
static struct quat q_align_to_z(const float a[3])
{
	/* axis = a x z, angle = acos(a . z) */
	float ax = a[1], ay = -a[0];
	float c = a[2];
	float s = sqrtf(ax * ax + ay * ay);

	if (s < 1e-6f) {
		return c > 0 ? (struct quat){1, 0, 0, 0} : (struct quat){0, 1, 0, 0};
	}
	float ang = atan2f(s, c);
	float h = sinf(ang / 2) / s;

	return (struct quat){cosf(ang / 2), ax * h, ay * h, 0};
}

static float dot3(const float a[3], const float b[3])
{
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

void sample_centre_acc_g(const struct sample *s, float out[3])
{
	bool clip = false;

	for (int i = 0; i < 3; i++) {
		clip |= abs(s->acc[i]) > IMU_ACC_CLIP_LSB;
	}
	for (int i = 0; i < 3; i++) {
		out[i] = clip ? s->hg[i] * IMU_HG_G_PER_LSB : s->acc[i] * IMU_ACC_G_PER_LSB;
	}
}

static void rim_acc_g(const struct sample *s, float out[3])
{
	bool clip = false;

	for (int i = 0; i < 3; i++) {
		clip |= abs(s->r_acc[i]) > IMU_ACC_CLIP_LSB;
	}
	for (int i = 0; i < 3; i++) {
		out[i] = clip ? s->r_hg[i] * IMU_HG_G_PER_LSB : s->r_acc[i] * IMU_ACC_G_PER_LSB;
	}
}

float sample_spin_dps(const struct sample *s, float rim_radius_m, bool *centrip)
{
	float gz = s->gyro[2] * IMU_GYRO_DPS_PER_LSB;

	if (centrip) {
		*centrip = false;
	}
	if (fabsf(gz) < 3900.0f || rim_radius_m <= 0.0f) {
		return gz;
	}
	/* Gyro saturated (>= ~650 rpm). The rim IMU sees centripetal a = w^2 r towards the centre,
	 * on top of whatever the centre IMU sees, so the in-plane difference gives |w|. */
	float c[3], r[3];

	sample_centre_acc_g(s, c);
	rim_acc_g(s, r);
	float d = hypotf(r[0] - c[0], r[1] - c[1]) * 9.80665f;
	float w = sqrtf(d / rim_radius_m) * (180.0f / 3.14159265f);

	if (centrip) {
		*centrip = true;
	}
	return copysignf(w, gz);
}

/* Reference for "up" and for zero velocity, taken before the pull.
 *
 * A single short window is a poor gravity reference unless the disc is truly at rest: the hand
 * is accelerating, and 0.1 g sideways is already 6 degrees. So the reference is the whole span
 * from the first calm window to the last: with the gyro tracking the rotation, the specific
 * force averaged over a span of T seconds is 1 g up plus (change in velocity) / T, and the
 * hand's velocity changes little between two calm moments. Whatever happens in between (a
 * step, a wind-up) cancels out. Recorded throws put this within a few degrees, where single
 * windows 50 ms apart disagreed by 10-20 degrees.
 *
 * If nothing is that calm, the calmest 100 ms is the whole span and the result is flagged as
 * approximate. */
#define CALM_MAX_DG       0.15f   /* window mean |a| within this of 1 g */
#define CALM_MAX_RMS_DPS  100.0f
#define ROUGH_MAX_DG      0.25f   /* fallback */
#define ROUGH_MAX_RMS_DPS 300.0f
#define SPAN_MIN_N        (IMU_ACTIVE_HZ / 2)  /* shorter than this needs a truly still window */
#define SPAN_MAX_DG       0.06f                /* span mean must come out this close to 1 g */

struct ref_span {
	int from, to;   /* samples [from, to) */
	bool still;     /* contains a window with next to no rotation */
	bool rough;     /* fallback: one window that is merely the calmest */
};

static bool find_ref(const struct capture_view *cap, struct ref_span *ref)
{
	int first = -1, last = -1, rough = -1;
	float rough_score = 1e9f;

	ref->still = false;
	for (int start = 0; start + STILL_N <= cap->pull_idx; start += STILL_N / 4) {
		float sum_g = 0, sum_g2 = 0, max_dps = 0, sum_w2 = 0;

		for (int i = start; i < start + STILL_N; i++) {
			const struct sample *s = capture_get(i);
			float a[3];

			sample_centre_acc_g(s, a);
			float g = sqrtf(dot3(a, a));

			for (int k = 0; k < 3; k++) {
				float w = s->gyro[k] * IMU_GYRO_DPS_PER_LSB;

				max_dps = MAX(max_dps, fabsf(w));
				sum_w2 += w * w;
			}
			sum_g += g;
			sum_g2 += g * g;
		}
		float mean_g = sum_g / STILL_N;
		float dg = fabsf(mean_g - 1.0f);
		float var = sum_g2 / STILL_N - mean_g * mean_g;
		float rms_dps = sqrtf(sum_w2 / STILL_N);

		if (dg < CALM_MAX_DG && rms_dps < CALM_MAX_RMS_DPS) {
			if (first < 0) {
				first = start;
			}
			last = start;
			ref->still |= max_dps < STILL_MAX_DPS;
		}
		/* Fallback candidate: steady, close to 1 g, little rotation, and late (less drift). */
		float late = (float)(cap->pull_idx - start) / IMU_ACTIVE_HZ * 0.001f;
		float score = var + dg * 0.5f + rms_dps * 0.001f + late;

		if (dg < ROUGH_MAX_DG && rms_dps < ROUGH_MAX_RMS_DPS && score < rough_score) {
			rough_score = score;
			rough = start;
		}
	}
	ref->rough = first < 0;
	if (ref->rough) {
		first = last = rough;
	}
	if (first < 0) {
		return false;
	}
	ref->from = first;
	ref->to = last + STILL_N;
	return true;
}

/* q <- q * exp(w dt / 2), w in rad/s in the sensor frame */
static void q_step(struct quat *q, const float w[3])
{
	float th = sqrtf(dot3(w, w)) * DT;

	if (th > 1e-9f) {
		float h = sinf(th / 2) / (th / DT);
		struct quat dq = {cosf(th / 2), w[0] * h, w[1] * h, w[2] * h};

		*q = qmul(*q, dq);
		qnorm(q);
	}
}

static void sample_rate_rad(const struct capture_view *cap, const struct sample *s, float w[3])
{
	w[0] = s->gyro[0] * IMU_GYRO_DPS_PER_LSB / DEG;
	w[1] = s->gyro[1] * IMU_GYRO_DPS_PER_LSB / DEG;
	w[2] = sample_spin_dps(s, cap->rim_radius_m, NULL) / DEG;
}

void analysis_run(const struct capture_view *cap, struct throw_result *out)
{
	/* Spin rate just after release. */
	float spin = 0;
	int n_spin = 0;
	bool centrip = false;

	for (int i = cap->release_idx; i < MIN(cap->len, cap->release_idx + SPIN_AVG_N); i++) {
		bool c;

		spin += sample_spin_dps(capture_get(i), cap->rim_radius_m, &c);
		centrip |= c;
		n_spin++;
	}
	if (n_spin) {
		out->spin_rpm = (int16_t)CLAMP(spin / n_spin / 6.0f, INT16_MIN, INT16_MAX);
	}
	if (centrip) {
		out->flags |= RESULT_SPIN_CENTRIP;
	}

	/* Wobble: RMS of the off-axis rotation rate after the release transient. */
	float w2 = 0;
	int n_w = 0;

	for (int i = cap->release_idx + SPIN_AVG_N; i < cap->len; i++) {
		const struct sample *s = capture_get(i);
		float gx = s->gyro[0] * IMU_GYRO_DPS_PER_LSB, gy = s->gyro[1] * IMU_GYRO_DPS_PER_LSB;

		w2 += gx * gx + gy * gy;
		n_w++;
	}
	if (n_w) {
		out->wobble_dps = (uint16_t)sqrtf(w2 / n_w);
	}

	/* Orientation + velocity from the reference span. */
	struct ref_span ref;

	if (!find_ref(cap, &ref)) {
		LOG_WRN("nothing calm enough before the throw: no speed / angles");
		out->flags |= RESULT_NO_REF;
		return;
	}

	/* Track orientation through the span in the frame of its first sample, averaging the
	 * specific force there: the mean points up. */
	struct quat q = {1, 0, 0, 0};
	float sum[3] = {0};

	for (int i = ref.from; i < ref.to; i++) {
		const struct sample *s = capture_get(i);
		float a[3], aw[3], w[3];

		sample_centre_acc_g(s, a);
		qrot(q, a, aw);
		for (int k = 0; k < 3; k++) {
			sum[k] += aw[k];
		}
		sample_rate_rad(cap, s, w);
		q_step(&q, w);
	}
	float mag = sqrtf(dot3(sum, sum));
	float mean_g = mag / (ref.to - ref.from);
	float up_s[3] = {sum[0] / mag, sum[1] / mag, sum[2] / mag};

	if (ref.rough || (!ref.still && ref.to - ref.from < SPAN_MIN_N) ||
	    fabsf(mean_g - 1.0f) > SPAN_MAX_DG) {
		LOG_INF("weak reference before the throw (%d ms, mean %.2f g): approximate",
			(ref.to - ref.from) * 1000 / IMU_ACTIVE_HZ, (double)mean_g);
		out->flags |= RESULT_REF_APPROX;
	}
	/* Re-base so that world z is up, then carry on to the release. */
	q = qmul(q_align_to_z(up_s), q);

	float v[3] = {0};

	for (int i = ref.to; i < cap->release_idx; i++) {
		const struct sample *s = capture_get(i);
		float a[3], aw[3], w[3];

		/* velocity: specific force -> world, minus gravity */
		sample_centre_acc_g(s, a);
		qrot(q, a, aw);
		aw[2] -= 1.0f;
		for (int k = 0; k < 3; k++) {
			v[k] += aw[k] * G0 * DT;
		}
		sample_rate_rad(cap, s, w);
		q_step(&q, w);
	}

	float speed = sqrtf(dot3(v, v));
	float vh = hypotf(v[0], v[1]);

	if (speed > 60.0f || vh < 0.5f) {
		LOG_WRN("implausible release velocity %.1f m/s", (double)speed);
		out->flags |= RESULT_BAD_SPEED;
		return;
	}
	out->speed_cms = (uint16_t)(speed * 100.0f);
	out->flags |= RESULT_SPEED_VALID;

	const float up[3] = {0, 0, 1};
	const float z_s[3] = {0, 0, 1};
	float n[3];
	float f[3] = {v[0] / vh, v[1] / vh, 0};          /* forward, horizontal */
	float r[3] = {f[1], -f[0], 0};                   /* right = forward x up */

	qrot(q, z_s, n);                                 /* disc normal in the world frame */
	/* Board z may point down if the disc is mounted upside down: use the upward normal. */
	if (n[2] < 0) {
		for (int k = 0; k < 3; k++) {
			n[k] = -n[k];
		}
	}
	out->hyzer_cdeg = (int16_t)(atan2f(dot3(n, r), dot3(n, up)) * DEG * 100.0f);
	out->nose_cdeg = (int16_t)(atan2f(-dot3(n, f), dot3(n, up)) * DEG * 100.0f);
	out->launch_cdeg = (int16_t)(atan2f(v[2], vh) * DEG * 100.0f);
	out->flags |= RESULT_ANGLES_VALID;
}
