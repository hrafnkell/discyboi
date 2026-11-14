/* Battery voltage: VBAT -> 10M/10M divider (+100 nF) -> AIN2, sampled once a minute.
 * The 100 nF cap holds the divider node so the ADC's sampling charge comes from it. */
#include <zephyr/bluetooth/services/bas.h>
#include <zephyr/drivers/adc.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "discy.h"

LOG_MODULE_REGISTER(battery, LOG_LEVEL_INF);

#define DIVIDER        2
#define PERIOD         K_SECONDS(60)

static const struct adc_dt_spec vbat = ADC_DT_SPEC_GET_BY_IDX(DT_PATH(zephyr_user), 0);
static uint16_t last_mv;

/* CR2032 (or LIR2032 under ~2 mA): the voltage sits on a 2.8-2.9 V plateau for most of the
 * capacity, then falls off. The electronics run down to ~1.8 V, so 2.0 V is "empty". */
static const struct curve_pt { uint16_t mv; uint8_t pct; } coin_curve[] = {
	{3000, 100}, {2900, 85}, {2800, 60}, {2700, 40}, {2600, 25},
	{2500, 15}, {2400, 8}, {2200, 3}, {2000, 0},
};

/* Rough 1S LiPo discharge curve at light load. */
static const struct curve_pt lipo_curve[] = {
	{4200, 100}, {4100, 90}, {4000, 80}, {3900, 65}, {3800, 50},
	{3750, 40}, {3700, 30}, {3650, 20}, {3600, 10}, {3500, 5}, {3300, 0},
};

/* A CR2032 never reads above ~3.3 V; a LiPo is above this for nearly all of its charge. */
#define LIPO_DETECT_MV 3450

static bool is_lipo = IS_ENABLED(CONFIG_DISCY_BATTERY_LIPO);

static uint8_t interp(const struct curve_pt *c, size_t n, uint16_t mv)
{
	if (mv >= c[0].mv) {
		return 100;
	}
	for (size_t i = 1; i < n; i++) {
		if (mv >= c[i].mv) {
			return c[i].pct + (mv - c[i].mv) * (c[i - 1].pct - c[i].pct) / (c[i - 1].mv - c[i].mv);
		}
	}
	return 0;
}

static uint8_t mv_to_pct(uint16_t mv)
{
	if (IS_ENABLED(CONFIG_DISCY_BATTERY_AUTO) && !is_lipo && mv > LIPO_DETECT_MV) {
		is_lipo = true;
		LOG_INF("VBAT %u mV: LiPo detected", mv);
	}
	return is_lipo ? interp(lipo_curve, ARRAY_SIZE(lipo_curve), mv)
		       : interp(coin_curve, ARRAY_SIZE(coin_curve), mv);
}

uint16_t battery_mv(void)
{
	return last_mv;
}

static int measure(void)
{
	int16_t raw;
	struct adc_sequence seq = {.buffer = &raw, .buffer_size = sizeof(raw)};
	int err = adc_sequence_init_dt(&vbat, &seq);

	err = err ?: adc_read_dt(&vbat, &seq);
	if (err) {
		return err;
	}
	int32_t mv = raw;

	err = adc_raw_to_millivolts_dt(&vbat, &mv);
	if (err) {
		return err;
	}
	last_mv = (uint16_t)CLAMP(mv * DIVIDER, 0, UINT16_MAX);
	bt_bas_set_battery_level(mv_to_pct(last_mv));
	return 0;
}

static void battery_work_handler(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(battery_work, battery_work_handler);

static void battery_work_handler(struct k_work *work)
{
	int err = measure();

	if (err) {
		LOG_WRN("VBAT read failed (%d)", err);
	}
	k_work_schedule(&battery_work, PERIOD);
}

int battery_init(void)
{
	if (!adc_is_ready_dt(&vbat)) {
		return -ENODEV;
	}
	int err = adc_channel_setup_dt(&vbat);

	if (err) {
		return err;
	}
	measure();
	LOG_INF("battery %u mV (%u%%)", last_mv, mv_to_pct(last_mv));
	k_work_schedule(&battery_work, PERIOD);
	return 0;
}
