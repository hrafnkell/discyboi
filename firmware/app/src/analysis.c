/*
 * Throw analysis on a frozen capture. Preliminary and deliberately simple:
 *
 * 1. Find a still moment before the pull (100 ms with |a| ~ 1 g and little rotation). Its mean
 *    accelerometer reading defines "up" and the starting orientation.
 * 2. Integrate the gyro from there to release to track orientation (when the gyro saturates on
 *    z, the spin rate comes from the rim/centre centripetal difference instead).
 * 3. Rotate the centre accelerometer into the world frame, remove gravity and integrate to get
 *    the release velocity.
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

/* Best still window before the pull: returns its first index, or -1. */
static int find_still(const struct capture_view *cap, float up_sensor[3])
{
	int best = -1;
	float best_score = 1e9f;

	for (int start = 0; start + STILL_N <= cap->pull_idx; start += STILL_N / 4) {
		float sum[3] = {0}, sum_g = 0, sum_g2 = 0, max_dps = 0;

		for (int i = start; i < start + STILL_N; i++) {
			const struct sample *s = capture_get(i);
			float a[3];

			sample_centre_acc_g(s, a);
			float g = sqrtf(dot3(a, a));

			for (int k = 0; k < 3; k++) {
				sum[k] += a[k];
				max_dps = MAX(max_dps, fabsf(s->gyro[k] * IMU_GYRO_DPS_PER_LSB));
			}
			sum_g += g;
			sum_g2 += g * g;
		}
		float mean_g = sum_g / STILL_N;
		float var = sum_g2 / STILL_N - mean_g * mean_g;
		/* Prefer windows close to 1 g, steady, and late (closest to the throw: less drift). */
		float score = var + fabsf(mean_g - 1.0f) * 0.1f +
			      (float)(cap->pull_idx - start) / IMU_ACTIVE_HZ * 0.001f;

		if (fabsf(mean_g - 1.0f) < 0.15f && max_dps < STILL_MAX_DPS && score < best_score) {
			best_score = score;
			best = start;
			float n = sqrtf(dot3(sum, sum));

			for (int k = 0; k < 3; k++) {
				up_sensor[k] = sum[k] / n;
			}
		}
	}
	return best;
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

	/* Orientation + velocity from a still reference. */
	float up_s[3];
	int still = find_still(cap, up_s);

	if (still < 0) {
		LOG_WRN("no still moment before the throw: no speed / angles");
		return;
	}
	struct quat q = q_align_to_z(up_s);
	float v[3] = {0};
	int from = still + STILL_N / 2;

	for (int i = from; i < cap->release_idx; i++) {
		const struct sample *s = capture_get(i);
		float a[3], aw[3];
		float wz = sample_spin_dps(s, cap->rim_radius_m, NULL);
		float w[3] = {s->gyro[0] * IMU_GYRO_DPS_PER_LSB / DEG, s->gyro[1] * IMU_GYRO_DPS_PER_LSB / DEG,
			      wz / DEG};

		/* velocity: specific force -> world, minus gravity */
		sample_centre_acc_g(s, a);
		qrot(q, a, aw);
		aw[2] -= 1.0f;
		for (int k = 0; k < 3; k++) {
			v[k] += aw[k] * G0 * DT;
		}

		/* orientation: q <- q * exp(w dt / 2) */
		float th = sqrtf(dot3(w, w)) * DT;

		if (th > 1e-9f) {
			float h = sinf(th / 2) / (th / DT);
			struct quat dq = {cosf(th / 2), w[0] * h, w[1] * h, w[2] * h};

			q = qmul(q, dq);
			qnorm(&q);
		}
	}

	float speed = sqrtf(dot3(v, v));
	float vh = hypotf(v[0], v[1]);

	if (speed > 60.0f || vh < 0.5f) {
		LOG_WRN("implausible release velocity %.1f m/s", (double)speed);
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
