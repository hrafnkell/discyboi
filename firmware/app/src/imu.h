/* Minimal LSM6DSV320X driver over SPI (register-level, no Zephyr sensor API). */
#pragma once
#include <stdint.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/spi.h>

/* Scale factors for the ranges configured in imu.c */
#define IMU_GYRO_DPS_PER_LSB   0.140f      /* +-4000 dps */
#define IMU_ACC_G_PER_LSB      0.000488f   /* +-16 g low-g */
#define IMU_HG_G_PER_LSB       0.010417f   /* +-320 g high-g */
#define IMU_ACC_CLIP_LSB       32000       /* treat low-g as saturated above this */

enum imu_mode {
	IMU_MODE_OFF,
	IMU_MODE_IDLE,    /* low-g accel only, low-power 30 Hz: motion wake-up */
	IMU_MODE_ACTIVE,  /* gyro + low-g + high-g, 960 Hz high-performance */
};

#define IMU_ACTIVE_HZ 960
#define IMU_IDLE_HZ   30

struct imu {
	const char *name;
	struct spi_dt_spec spi;
	struct gpio_dt_spec int1;
	float radius_m;
};

/* One raw reading. gyro is only meaningful from the centre IMU (the rim IMU's gyro is off). */
struct imu_raw {
	int16_t gyro[3];
	int16_t acc[3];
	int16_t hg[3];
};

int imu_init(const struct imu *imu);
int imu_set_mode(const struct imu *imu, enum imu_mode mode, bool with_gyro);
/* Data-ready on INT1 (pulsed) for the low-g accelerometer. */
int imu_enable_drdy(const struct imu *imu);
int imu_read(const struct imu *imu, struct imu_raw *out);
