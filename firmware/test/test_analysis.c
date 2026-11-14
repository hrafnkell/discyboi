/*
 * Host test for analysis.c: synthesise a throw with known release speed, angles and spin,
 * quantise it like the IMUs would, and check what the analysis recovers.
 *   make -C test   (or: cc -O2 -Itest/stubs -Iapp/src test/test_analysis.c app/src/analysis.c -lm)
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "discy.h"

#define HZ IMU_ACTIVE_HZ
#define G0 9.80665
#define D2R (M_PI / 180.0)

static struct sample buf[CAPTURE_LEN];
const struct sample *capture_get(uint16_t i) { return &buf[i]; }

typedef struct { double m[3][3]; } mat;

static mat mmul(mat a, mat b)
{
	mat r = {0};
	for (int i = 0; i < 3; i++)
		for (int j = 0; j < 3; j++)
			for (int k = 0; k < 3; k++) r.m[i][j] += a.m[i][k] * b.m[k][j];
	return r;
}
static void mtv(mat a, const double v[3], double o[3]) /* a^T v */
{
	for (int i = 0; i < 3; i++) o[i] = a.m[0][i] * v[0] + a.m[1][i] * v[1] + a.m[2][i] * v[2];
}
static mat rotz(double a)
{
	return (mat){{{cos(a), -sin(a), 0}, {sin(a), cos(a), 0}, {0, 0, 1}}};
}
/* Rotation taking +z onto unit n (Rodrigues). */
static mat align_z_to(const double n[3])
{
	double k[3] = {-n[1], n[0], 0}, s = hypot(k[0], k[1]), c = n[2];
	if (s < 1e-12) return (mat){{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}};
	k[0] /= s; k[1] /= s;
	double K[3][3] = {{0, -k[2], k[1]}, {k[2], 0, -k[0]}, {-k[1], k[0], 0}};
	mat r;
	for (int i = 0; i < 3; i++)
		for (int j = 0; j < 3; j++) {
			double kk = 0;
			for (int l = 0; l < 3; l++) kk += K[i][l] * K[l][j];
			r.m[i][j] = (i == j) + s * K[i][j] + (1 - c) * kk;
		}
	return r;
}
static int16_t q16(double v, double lsb, double clip)
{
	v = fmax(fmin(v, clip), -clip);
	return (int16_t)lround(v / lsb);
}

struct throw_spec {
	const char *name;
	double speed, hyzer, nose, launch, rpm;
	double gyro_noise_dps, acc_noise_g;
};

static int run(const struct throw_spec *t)
{
	const double r_rim = 0.009, pull_s = 0.3;
	const int pull_idx = CAPTURE_PRE - (int)(pull_s * HZ), release_idx = CAPTURE_PRE;
	/* disc normal for the requested hyzer (+ = right edge down, right = -y) and nose (+ = up) */
	double n[3] = {-tan(t->nose * D2R), -tan(t->hyzer * D2R), 1}, nl = sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
	for (int k = 0; k < 3; k++) n[k] /= nl;
	mat tilt = align_z_to(n);
	double A = t->speed / pull_s, Om = t->rpm * 2 * M_PI / 60;
	double phi = 0;

	srand(1);
	for (int i = 0; i < CAPTURE_LEN; i++) {
		double aw[3] = {0, 0, 0}, w = 0, alpha = 0;
		if (i >= pull_idx && i < release_idx) {        /* pull: constant accel, spin ramps up */
			aw[0] = A * cos(t->launch * D2R);
			aw[2] = A * sin(t->launch * D2R);
			alpha = Om / pull_s;
			w = alpha * (i - pull_idx + 0.5) / HZ;
		} else if (i >= release_idx) {
			w = Om;
		}
		phi += w / HZ;
		mat R = mmul(tilt, rotz(phi));
		/* specific force: free flight reads ~0 (aero ignored); otherwise a + 1 g up */
		double f[3] = {aw[0] / G0, aw[1] / G0, i >= release_idx ? 0 : aw[2] / G0 + 1}, fs[3];
		mtv(R, f, fs);
		double nz = ((rand() / (double)RAND_MAX) - 0.5) * 2;
		struct sample *s = &buf[i];
		for (int k = 0; k < 3; k++) {
			double gyro = (k == 2 ? w * 180 / M_PI : 0) + t->gyro_noise_dps * nz;
			s->gyro[k] = q16(gyro, IMU_GYRO_DPS_PER_LSB, 4000);
			s->acc[k] = q16(fs[k] + t->acc_noise_g * nz, IMU_ACC_G_PER_LSB, 16);
			s->hg[k] = q16(fs[k], IMU_HG_G_PER_LSB, 320);
		}
		/* rim IMU at body (-r, 0, 0): + centripetal (towards centre) + tangential */
		double rim[3] = {fs[0] + w * w * r_rim / G0, fs[1] - alpha * r_rim / G0, fs[2]};
		for (int k = 0; k < 3; k++) {
			s->r_acc[k] = q16(rim[k], IMU_ACC_G_PER_LSB, 16);
			s->r_hg[k] = q16(rim[k], IMU_HG_G_PER_LSB, 320);
		}
	}

	struct capture_view cap = {.throw_id = 1, .len = CAPTURE_LEN, .pull_idx = pull_idx,
				   .release_idx = release_idx, .rim_radius_m = r_rim};
	struct throw_result r = {0};
	analysis_run(&cap, &r);

	double e_speed = r.speed_cms / 100.0 - t->speed, e_h = r.hyzer_cdeg / 100.0 - t->hyzer,
	       e_n = r.nose_cdeg / 100.0 - t->nose, e_l = r.launch_cdeg / 100.0 - t->launch,
	       e_rpm = r.spin_rpm - t->rpm;
	int ok = (r.flags & RESULT_ANGLES_VALID) && (r.flags & RESULT_SPEED_VALID) &&
		 fabs(e_speed) < 0.3 && fabs(e_h) < 1 && fabs(e_n) < 1 && fabs(e_l) < 1 &&
		 fabs(e_rpm) < t->rpm * 0.02;
	printf("%-4s %-34s speed %5.2f (%+.2f)  hyzer %6.2f (%+.2f)  nose %6.2f (%+.2f)  launch %5.2f (%+.2f)  spin %5d (%+.0f)%s  wobble %u\n",
	       ok ? "ok" : "FAIL", t->name, r.speed_cms / 100.0, e_speed, r.hyzer_cdeg / 100.0, e_h,
	       r.nose_cdeg / 100.0, e_n, r.launch_cdeg / 100.0, e_l, r.spin_rpm, e_rpm,
	       (r.flags & RESULT_SPIN_CENTRIP) ? " [centrip]" : "", r.wobble_dps);
	return ok;
}

int main(void)
{
	const struct throw_spec cases[] = {
		{"flat putt, slow spin", 10, 0, 0, 0, 400},
		{"drive, hyzer + nose down", 22, 12, -4, 8, 900},
		{"anhyzer, nose up", 18, -15, 6, 12, 700},
		{"big arm (high-g rim, centripetal)", 28, 5, -2, 10, 1500},
		{"drive with sensor noise", 22, 12, -4, 8, 900, 1.0, 0.003},
	};
	int pass = 0, n = sizeof(cases) / sizeof(cases[0]);
	for (int i = 0; i < n; i++) pass += run(&cases[i]);
	printf("%d/%d passed\n", pass, n);
	return pass == n ? 0 : 1;
}
