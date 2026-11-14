/*
 * Sampling thread and throw state machine.
 *
 * IDLE   centre IMU accel only, low-power 30 Hz. Any motion -> ARMED.
 * ARMED  both IMUs at 960 Hz into a ring buffer. Centre accel > PULL_G for PULL_MIN_MS -> PULL.
 *        No motion for IDLE_AFTER_S -> IDLE.
 * PULL   waits for release: centre accel drops below RELEASE_G while the disc is spinning.
 * POST   records CAPTURE_POST more samples, then freezes the buffer and runs the analysis.
 * FLIGHT times the flight until an impact, the disc stops spinning, or a timeout.
 */
#include <math.h>
#include <stdlib.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "discy.h"

LOG_MODULE_REGISTER(capture, LOG_LEVEL_INF);

#define PULL_G           4.0f
#define PULL_MIN_MS      20
#define PULL_MAX_MS      1500
#define RELEASE_G        2.5f
#define RELEASE_MIN_RPM  200.0f
#define RELEASE_MIN_MS   5
#define LAND_IMPACT_G    6.0f
#define LAND_STOP_RPM    60.0f
#define LAND_STOP_MS     50
#define FLIGHT_MAX_MS    15000
#define WAKE_DELTA_G     0.35f
#define QUIET_DELTA_G    0.10f
#define QUIET_GYRO_DPS   15.0f
#define IDLE_AFTER_S     30

#define MS_TO_N(ms) ((uint32_t)(ms) * IMU_ACTIVE_HZ / 1000)

#define IMU_SPI_OP (SPI_WORD_SET(8) | SPI_TRANSFER_MSB | SPI_MODE_CPOL | SPI_MODE_CPHA)

static const struct imu imu_c = {
	.name = "centre",
	.spi = SPI_DT_SPEC_GET(DT_NODELABEL(imu_centre), IMU_SPI_OP, 0),
	.int1 = GPIO_DT_SPEC_GET(DT_NODELABEL(imu_centre), int1_gpios),
	.radius_m = DT_PROP(DT_NODELABEL(imu_centre), radius_um) * 1e-6f,
};
static const struct imu imu_r = {
	.name = "rim",
	.spi = SPI_DT_SPEC_GET(DT_NODELABEL(imu_rim), IMU_SPI_OP, 0),
	.int1 = GPIO_DT_SPEC_GET(DT_NODELABEL(imu_rim), int1_gpios),
	.radius_m = DT_PROP(DT_NODELABEL(imu_rim), radius_um) * 1e-6f,
};

static struct sample ring[CAPTURE_LEN];
static uint32_t ring_n;        /* samples written since the ring was last reset */
static uint32_t armed_n;       /* ring_n when the IMUs last woke: older samples are stale */
static uint32_t frozen_end;    /* ring_n when the current capture was frozen */
static struct capture_view frozen;
static bool have_capture;
static atomic_t locked;
static uint32_t throws;
static volatile enum capture_state state = CAP_IDLE;

static K_SEM_DEFINE(drdy_sem, 0, 1);
static struct gpio_callback drdy_cb;

static void drdy_isr(const struct device *dev, struct gpio_callback *cb, uint32_t pins)
{
	k_sem_give(&drdy_sem);
}

const struct sample *capture_get(uint16_t i)
{
	uint32_t start = frozen_end - frozen.len;

	return &ring[(start + i) % CAPTURE_LEN];
}

bool capture_lock(struct capture_view *view)
{
	/* Only while no capture is being written (the ring stops advancing while locked). */
	bool quiet_state = state == CAP_IDLE || state == CAP_ARMED || state == CAP_FLIGHT;

	if (!have_capture || !quiet_state || !atomic_cas(&locked, 0, 1)) {
		return false;
	}
	*view = frozen;
	return true;
}

void capture_unlock(void)
{
	atomic_set(&locked, 0);
}

enum capture_state capture_state(void)
{
	return state;
}

uint32_t capture_throw_count(void)
{
	return throws;
}

static void set_state(enum capture_state s)
{
	static const char *const names[] = {"IDLE", "ARMED", "PULL", "POST", "FLIGHT"};

	if (s == state) {
		return;
	}
	LOG_INF("%s -> %s", names[state], names[s]);
	state = s;
	ble_publish_status();
}

static int set_mode(enum imu_mode mode)
{
	int err = imu_set_mode(&imu_c, mode, true);

	err |= imu_set_mode(&imu_r, mode == IMU_MODE_ACTIVE ? IMU_MODE_ACTIVE : IMU_MODE_OFF, false);
	return err;
}

static void enter_armed(void)
{
	if (state == CAP_IDLE) {
		set_mode(IMU_MODE_ACTIVE);
		armed_n = ring_n;
	}
	set_state(CAP_ARMED);
}

static float norm3(const float v[3])
{
	return sqrtf(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

static void finish_throw(uint32_t release_n, uint32_t land_n, bool landed,
			 struct throw_result *res)
{
	res->flight_ms = (uint16_t)MIN((land_n - release_n) * 1000 / IMU_ACTIVE_HZ, UINT16_MAX);
	if (landed) {
		res->flags |= RESULT_LANDED;
	}
	res->battery_mv = battery_mv();
	LOG_INF("throw %u: spin %d rpm, speed %u.%02u m/s, hyzer %d.%02d, nose %d.%02d, flight %u ms",
		res->throw_id, res->spin_rpm, res->speed_cms / 100, res->speed_cms % 100,
		res->hyzer_cdeg / 100, abs(res->hyzer_cdeg % 100), res->nose_cdeg / 100,
		abs(res->nose_cdeg % 100), res->flight_ms);
	ble_publish_result(res);
	led_blink(1);
}

static void sampler(void *a, void *b, void *c)
{
	struct imu_raw rc, rr = {0};
	struct sample s;
	struct throw_result res;
	uint32_t run = 0;        /* consecutive samples meeting the current state's condition */
	uint32_t quiet = 0;
	uint32_t pull_n = 0, release_n = 0, land_n = 0, stop_run = 0;
	bool landed = false;
	float peak_g = 0;

	while (true) {
		bool idle = state == CAP_IDLE;

		/* DRDY is pulsed; the timeout catches a missed edge rather than stalling. */
		k_sem_take(&drdy_sem, K_MSEC(idle ? 100 : 5));
		if (imu_read(&imu_c, &rc)) {
			continue;
		}
		if (!idle) {
			imu_read(&imu_r, &rr);
		}
		memcpy(s.gyro, rc.gyro, sizeof(s.gyro));
		memcpy(s.acc, rc.acc, sizeof(s.acc));
		memcpy(s.hg, rc.hg, sizeof(s.hg));
		memcpy(s.r_acc, rr.acc, sizeof(s.r_acc));
		memcpy(s.r_hg, rr.hg, sizeof(s.r_hg));

		float acc[3];

		sample_centre_acc_g(&s, acc);
		float g = norm3(acc);

		if (idle) {
			if (fabsf(g - 1.0f) > WAKE_DELTA_G) {
				enter_armed();
				run = quiet = 0;
			}
			continue;
		}

		float spin_rpm = fabsf(sample_spin_dps(&s, imu_r.radius_m, NULL)) / 6.0f;
		bool recording = state == CAP_ARMED || state == CAP_PULL || state == CAP_POST;

		if (recording && !atomic_get(&locked)) {
			ring[ring_n % CAPTURE_LEN] = s;
			ring_n++;
		}

		switch (state) {
		case CAP_ARMED: {
			float gyro_max = 0;

			for (int i = 0; i < 3; i++) {
				gyro_max = MAX(gyro_max, fabsf(s.gyro[i] * IMU_GYRO_DPS_PER_LSB));
			}
			quiet = (fabsf(g - 1.0f) < QUIET_DELTA_G && gyro_max < QUIET_GYRO_DPS) ? quiet + 1 : 0;
			if (quiet > IDLE_AFTER_S * IMU_ACTIVE_HZ) {
				set_mode(IMU_MODE_IDLE);
				set_state(CAP_IDLE);
				break;
			}
			if (atomic_get(&locked)) {
				break; /* a download owns the buffer: don't start a new capture */
			}
			run = g > PULL_G ? run + 1 : 0;
			if (run >= MS_TO_N(PULL_MIN_MS)) {
				pull_n = ring_n - run;
				peak_g = g;
				run = 0;
				set_state(CAP_PULL);
			}
			break;
		}
		case CAP_PULL:
			peak_g = MAX(peak_g, g);
			run = (g < RELEASE_G && spin_rpm > RELEASE_MIN_RPM) ? run + 1 : 0;
			if (run >= MS_TO_N(RELEASE_MIN_MS)) {
				release_n = ring_n - run;
				run = 0;
				landed = false;
				land_n = 0;
				stop_run = 0;
				set_state(CAP_POST);
			} else if (ring_n - pull_n > MS_TO_N(PULL_MAX_MS)) {
				run = 0;
				set_state(CAP_ARMED); /* never released: not a throw */
			}
			break;
		case CAP_POST:
		case CAP_FLIGHT:
			if (!landed) {
				stop_run = spin_rpm < LAND_STOP_RPM ? stop_run + 1 : 0;
				if (g > LAND_IMPACT_G || stop_run >= MS_TO_N(LAND_STOP_MS)) {
					landed = true;
					land_n = state == CAP_POST ? ring_n : land_n;
				}
			}
			break;
		default:
			break;
		}

		if (state == CAP_POST && ring_n - release_n >= CAPTURE_POST) {
			throws++;
			frozen_end = ring_n;
			frozen = (struct capture_view){
				.throw_id = throws,
				.len = MIN(ring_n - armed_n, CAPTURE_LEN),
				.rim_radius_m = imu_r.radius_m,
			};
			uint32_t start = frozen_end - frozen.len;

			frozen.pull_idx = pull_n > start ? pull_n - start : 0;
			frozen.release_idx = release_n - start;
			have_capture = true;

			memset(&res, 0, sizeof(res));
			res.throw_id = throws;
			res.peak_dg = (uint16_t)MIN(peak_g * 10.0f, UINT16_MAX);
			res.pull_ms = (release_n - pull_n) * 1000 / IMU_ACTIVE_HZ;
			analysis_run(&frozen, &res);
			/* Flight is timed in samples past the end of the ring from here on. */
			set_state(CAP_FLIGHT);
			if (landed) {
				finish_throw(release_n, land_n, true, &res);
				set_state(CAP_ARMED);
			}
			/* Continue counting samples (without storing) to time the flight. */
			continue;
		}

		if (state == CAP_FLIGHT) {
			/* ring_n no longer advances; count flight time with land_n as a sample counter. */
			land_n++;
			uint32_t now_n = frozen_end + land_n;

			if (landed || now_n - release_n > MS_TO_N(FLIGHT_MAX_MS)) {
				finish_throw(release_n, now_n, landed, &res);
				set_state(CAP_ARMED);
			}
		}
	}
}

K_THREAD_STACK_DEFINE(sampler_stack, 3072);
static struct k_thread sampler_thread;

int capture_start(void)
{
	int err = imu_init(&imu_c);

	if (err) {
		LOG_ERR("centre IMU init failed (%d)", err);
		return err;
	}
	err = imu_init(&imu_r);
	if (err) {
		LOG_ERR("rim IMU init failed (%d)", err);
		return err;
	}
	imu_enable_drdy(&imu_c);
	gpio_pin_interrupt_configure_dt(&imu_c.int1, GPIO_INT_EDGE_TO_ACTIVE);
	gpio_init_callback(&drdy_cb, drdy_isr, BIT(imu_c.int1.pin));
	gpio_add_callback_dt(&imu_c.int1, &drdy_cb);

	set_mode(IMU_MODE_IDLE);
	k_thread_create(&sampler_thread, sampler_stack, K_THREAD_STACK_SIZEOF(sampler_stack), sampler,
			NULL, NULL, NULL, K_PRIO_PREEMPT(2), 0, K_NO_WAIT);
	k_thread_name_set(&sampler_thread, "sampler");
	LOG_INF("IMUs up, rim radius %.1f mm", (double)(imu_r.radius_m * 1000.0f));
	return 0;
}
