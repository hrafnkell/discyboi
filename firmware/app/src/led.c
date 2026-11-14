/* Status LED: non-blocking blink patterns. */
#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>

#include "discy.h"

static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static atomic_t remaining;  /* half-periods left */

static void led_work_handler(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(led_work, led_work_handler);

static void led_work_handler(struct k_work *work)
{
	int left = atomic_dec(&remaining);

	if (left <= 0) {
		atomic_set(&remaining, 0);
		gpio_pin_set_dt(&led, 0);
		return;
	}
	gpio_pin_set_dt(&led, left % 2 == 0);  /* starts on, ends off */
	k_work_schedule(&led_work, K_MSEC(120));
}

void led_blink(int count)
{
	atomic_set(&remaining, count * 2);
	k_work_reschedule(&led_work, K_NO_WAIT);
}

int led_init(void)
{
	if (!gpio_is_ready_dt(&led)) {
		return -ENODEV;
	}
	return gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
}
