#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "discy.h"

LOG_MODULE_REGISTER(main, LOG_LEVEL_INF);

int main(void)
{
	int err;

	LOG_INF("discyboi firmware");
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
	return 0;
}
