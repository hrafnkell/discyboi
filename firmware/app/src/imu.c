#include "imu.h"

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>

LOG_MODULE_REGISTER(imu, LOG_LEVEL_INF);

/* Register map: LSM6DSV320X datasheet DS14623 rev 3, section 8 */
#define REG_INT1_CTRL     0x0D
#define REG_WHO_AM_I      0x0F
#define REG_CTRL1         0x10  /* accel op mode [6:4], ODR [3:0] */
#define REG_CTRL2         0x11  /* gyro op mode [6:4], ODR [3:0] */
#define REG_CTRL3         0x12  /* BOOT, BDU, IF_INC, SW_RESET */
#define REG_CTRL4         0x13  /* DRDY_PULSED = bit 1 */
#define REG_CTRL6         0x15  /* gyro FS [2:0], bit 3 must be 1 */
#define REG_CTRL8         0x17  /* accel FS [1:0] */
#define REG_OUTX_L_G      0x22  /* gyro 22-27, accel 28-2D, OIS 2E-33, high-g 34-39 */
#define REG_CTRL1_XL_HG   0x4E  /* REGOUT_EN bit 7, ODR [5:3], FS [2:0] */

#define WHO_AM_I_VAL      0x73

#define CTRL3_BDU         BIT(6)
#define CTRL3_IF_INC      BIT(2)
#define CTRL3_SW_RESET    BIT(0)
#define CTRL4_DRDY_PULSED BIT(1)
#define INT1_DRDY_XL      BIT(0)

#define ODR_30HZ          0x4
#define ODR_960HZ         0x9
#define OPMODE_HP         (0x0 << 4)
#define OPMODE_LP1        (0x4 << 4)
#define GYRO_FS_4000      (0x08 | 0x5)
#define ACC_FS_16G        0x3
#define HG_REGOUT_EN      BIT(7)
#define HG_ODR_960HZ      (0x4 << 3)
#define HG_FS_320G        0x4

static int write_reg(const struct imu *imu, uint8_t reg, uint8_t val)
{
	uint8_t buf[2] = {reg & 0x7F, val};
	const struct spi_buf tx = {.buf = buf, .len = sizeof(buf)};
	const struct spi_buf_set txs = {.buffers = &tx, .count = 1};

	return spi_write_dt(&imu->spi, &txs);
}

static int read_regs(const struct imu *imu, uint8_t reg, uint8_t *data, size_t len)
{
	uint8_t addr = reg | 0x80;
	const struct spi_buf tx = {.buf = &addr, .len = 1};
	const struct spi_buf_set txs = {.buffers = &tx, .count = 1};
	const struct spi_buf rx[2] = {{.buf = NULL, .len = 1}, {.buf = data, .len = len}};
	const struct spi_buf_set rxs = {.buffers = rx, .count = 2};

	return spi_transceive_dt(&imu->spi, &txs, &rxs);
}

int imu_init(const struct imu *imu)
{
	uint8_t id = 0;
	int err;

	if (!spi_is_ready_dt(&imu->spi) || !gpio_is_ready_dt(&imu->int1)) {
		return -ENODEV;
	}
	err = read_regs(imu, REG_WHO_AM_I, &id, 1);
	if (err) {
		return err;
	}
	if (id != WHO_AM_I_VAL) {
		LOG_ERR("%s: WHO_AM_I 0x%02x, expected 0x%02x", imu->name, id, WHO_AM_I_VAL);
		return -EIO;
	}

	write_reg(imu, REG_CTRL3, CTRL3_SW_RESET);
	k_msleep(5);
	err = write_reg(imu, REG_CTRL3, CTRL3_BDU | CTRL3_IF_INC);
	/* Full scales must be set while the sensors are powered down (gyro FS default is reserved). */
	err |= write_reg(imu, REG_CTRL6, GYRO_FS_4000);
	err |= write_reg(imu, REG_CTRL8, ACC_FS_16G);
	err |= write_reg(imu, REG_CTRL4, CTRL4_DRDY_PULSED);
	if (err) {
		return -EIO;
	}
	return gpio_pin_configure_dt(&imu->int1, GPIO_INPUT);
}

int imu_set_mode(const struct imu *imu, enum imu_mode mode, bool with_gyro)
{
	int err = 0;

	/* Power everything down first: high-g needs the low-g accel in high-performance mode,
	 * so the order of the writes below matters. */
	err |= write_reg(imu, REG_CTRL1_XL_HG, 0);
	err |= write_reg(imu, REG_CTRL2, 0);
	err |= write_reg(imu, REG_CTRL1, 0);

	switch (mode) {
	case IMU_MODE_OFF:
		break;
	case IMU_MODE_IDLE:
		err |= write_reg(imu, REG_CTRL1, OPMODE_LP1 | ODR_30HZ);
		break;
	case IMU_MODE_ACTIVE:
		err |= write_reg(imu, REG_CTRL1, OPMODE_HP | ODR_960HZ);
		if (with_gyro) {
			err |= write_reg(imu, REG_CTRL2, OPMODE_HP | ODR_960HZ);
		}
		err |= write_reg(imu, REG_CTRL1_XL_HG, HG_REGOUT_EN | HG_ODR_960HZ | HG_FS_320G);
		break;
	}
	return err ? -EIO : 0;
}

int imu_enable_drdy(const struct imu *imu)
{
	return write_reg(imu, REG_INT1_CTRL, INT1_DRDY_XL);
}

int imu_read(const struct imu *imu, struct imu_raw *out)
{
	/* One burst 0x22..0x39: gyro, accel, OIS (ignored), high-g. All little-endian int16. */
	uint8_t b[24];
	int err = read_regs(imu, REG_OUTX_L_G, b, sizeof(b));

	if (err) {
		return err;
	}
	for (int i = 0; i < 3; i++) {
		out->gyro[i] = (int16_t)sys_get_le16(&b[0 + 2 * i]);
		out->acc[i] = (int16_t)sys_get_le16(&b[6 + 2 * i]);
		out->hg[i] = (int16_t)sys_get_le16(&b[18 + 2 * i]);
	}
	return 0;
}
