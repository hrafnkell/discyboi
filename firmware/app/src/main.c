#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/dfu/mcuboot.h>

#include "discy.h"

LOG_MODULE_REGISTER(main, LOG_LEVEL_INF);

int main(void)
{
	int err;

	LOG_INF("discyboi firmware %s", discy_fw_version);
	if ((err = led_init())) {
		LOG_ERR("LED init failed (%d)", err);
	}
	if ((err = battery_init())) {
		LOG_ERR("battery init failed (%d)", err);
	}
	if ((err = ble_init())) {
		LOG_ERR("Bluetooth init failed (%d)", err);
	}
	err = capture_start();
	/* 3 blinks: all good. 10 fast blinks: an IMU did not respond (see RTT log). */
	led_blink(err ? 10 : 3);

	/* A Bluetooth update boots once as a test. Keep it only if both IMUs came up; otherwise
	 * the next reset (or flat battery) brings back the previous firmware. */
	if (!boot_is_img_confirmed()) {
		if (err) {
			LOG_WRN("new firmware failed its first boot check: not confirming");
		} else if (boot_write_img_confirmed()) {
			LOG_ERR("could not confirm new firmware");
		} else {
			LOG_INF("new firmware confirmed");
		}
	}
	return 0;
}
