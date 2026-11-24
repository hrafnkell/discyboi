/* Shared types: capture buffer and throw result. */
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "imu.h"

/* One time step from both IMUs (30 bytes, also the on-air format of a raw sample). */
struct sample {
	int16_t gyro[3];   /* centre IMU */
	int16_t acc[3];    /* centre IMU, low-g */
	int16_t hg[3];     /* centre IMU, high-g */
	int16_t r_acc[3];  /* rim IMU (r = 9 mm), low-g */
	int16_t r_hg[3];   /* rim IMU, high-g */
} __packed;

/* Capture window around a throw: 2.5 s before release (to find a still moment for the
 * gravity reference and cover the reach-back), 0.5 s after. 2880 * 30 B = 86 KB. */
#define CAPTURE_PRE   (IMU_ACTIVE_HZ * 5 / 2)
#define CAPTURE_POST  (IMU_ACTIVE_HZ / 2)
#define CAPTURE_LEN   (CAPTURE_PRE + CAPTURE_POST)

/* A frozen capture, read in chronological order through capture_get(). */
struct capture_view {
	uint32_t throw_id;
	uint16_t len;          /* samples available (may be < CAPTURE_LEN right after boot) */
	uint16_t pull_idx;     /* first sample of the pull (centre accel > PULL_G) */
	uint16_t release_idx;  /* first sample after release */
	float rim_radius_m;
};

const struct sample *capture_get(uint16_t i);

#define RESULT_ANGLES_VALID  BIT(0)  /* found a still moment before the throw */
#define RESULT_SPEED_VALID   BIT(1)
#define RESULT_SPIN_CENTRIP  BIT(2)  /* gyro saturated; spin from rim-centre accel difference */
#define RESULT_LANDED        BIT(3)  /* flight_ms measured to an impact / stop, not a timeout */
#define RESULT_REF_APPROX    BIT(4)  /* no truly still moment: reference is the calmest 100 ms, so
				      * speed and angles are approximate */
#define RESULT_NO_REF        BIT(5)  /* why speed / angles are missing: nothing calm enough before the pull */
#define RESULT_BAD_SPEED     BIT(6)  /* why speed / angles are missing: integrated velocity implausible */

/* Throw summary, sent as-is over BLE (little-endian). */
struct throw_result {
	uint32_t throw_id;
	uint16_t flags;
	int16_t spin_rpm;       /* + = counter-clockwise seen from the top of the board */
	uint16_t speed_cms;     /* release speed, cm/s */
	int16_t hyzer_cdeg;     /* disc roll about the flight direction, + = right edge down */
	int16_t nose_cdeg;      /* disc pitch relative to horizontal, + = nose up */
	int16_t launch_cdeg;    /* velocity angle above horizontal */
	uint16_t wobble_dps;    /* RMS off-axis rotation in the 0.5 s after release */
	uint16_t peak_dg;       /* peak centre acceleration during the pull, 0.1 g */
	uint16_t pull_ms;
	uint16_t flight_ms;
	uint16_t battery_mv;
} __packed;

void analysis_run(const struct capture_view *cap, struct throw_result *out);

/* Spin rate in dps about the board z axis for one sample: gyro, or centripetal estimate
 * from the rim IMU when the gyro is saturated. *centrip is set when the estimate was used. */
float sample_spin_dps(const struct sample *s, float rim_radius_m, bool *centrip);
/* Centre acceleration vector in g, switching to the high-g channel when low-g clips. */
void sample_centre_acc_g(const struct sample *s, float out[3]);

/* capture.c */
enum capture_state {
	CAP_IDLE,     /* low-power, waiting for motion */
	CAP_ARMED,    /* 960 Hz, ring buffer running, waiting for a pull */
	CAP_PULL,     /* pull detected, waiting for release */
	CAP_POST,     /* recording the post-release window */
	CAP_FLIGHT,   /* capture frozen, timing the flight */
};
int capture_start(void);
/* Freeze/unfreeze the capture buffer (while a download is running). Returns false if
 * there is no capture to lock. */
bool capture_lock(struct capture_view *view);
void capture_unlock(void);
enum capture_state capture_state(void);
uint32_t capture_throw_count(void);

/* ble.c */
extern const char discy_fw_version[];  /* "0.2.0+<git commit>" */
int ble_init(void);
void ble_publish_result(const struct throw_result *r);
void ble_publish_status(void);

/* battery.c */
int battery_init(void);
uint16_t battery_mv(void);

/* led.c */
int led_init(void);
void led_blink(int count);
