/*
 * Per-board calibration kept across reboots, battery swaps and firmware updates: a small ZMS
 * store in the "storage" partition (MCUboot updates never touch it).
 *
 * Holds the gyro cross-axis coupling learned from throws (struct xz_learn). Saving happens on
 * the system work queue, never on the 960 Hz sampler thread.
 */
#include <zephyr/drivers/flash.h>
#include <zephyr/fs/zms.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/storage/flash_map.h>

#include "discy.h"

LOG_MODULE_REGISTER(calib, LOG_LEVEL_INF);

#define ID_GYRO_XZ 1

/* Stored layout; bump .ver if it changes (an unknown version is ignored, i.e. relearned). */
struct gyro_xz_rec {
	uint8_t ver;
	uint8_t pad;
	uint16_t n;
	float k[2];
};
#define GYRO_XZ_VER 1

static struct zms_fs fs;
static bool mounted;

static int mount(void)
{
	if (mounted) {
		return 0;
	}
	struct flash_pages_info info;

	fs.flash_device = FIXED_PARTITION_DEVICE(storage_partition);
	if (!device_is_ready(fs.flash_device)) {
		return -ENODEV;
	}
	fs.offset = FIXED_PARTITION_OFFSET(storage_partition);
	int err = flash_get_page_info_by_offs(fs.flash_device, fs.offset, &info);

	if (err) {
		return err;
	}
	fs.sector_size = info.size;
	fs.sector_count = FIXED_PARTITION_SIZE(storage_partition) / info.size;
	err = zms_mount(&fs);
	if (err) {
		return err;
	}
	mounted = true;
	return 0;
}

int calib_load_xz(struct xz_learn *l)
{
	struct gyro_xz_rec rec;
	int err = mount();

	if (err) {
		LOG_ERR("calibration store unavailable (%d)", err);
		return err;
	}
	ssize_t len = zms_read(&fs, ID_GYRO_XZ, &rec, sizeof(rec));

	if (len != sizeof(rec) || rec.ver != GYRO_XZ_VER) {
		LOG_INF("no gyro cross-axis calibration yet: learning it from throws");
		return -ENOENT;
	}
	l->k[0] = rec.k[0];
	l->k[1] = rec.k[1];
	l->n = rec.n;
	LOG_INF("gyro cross-axis %d/%d (x1e-4) from %u throws", (int)(rec.k[0] * 1e4f),
		(int)(rec.k[1] * 1e4f), rec.n);
	return 0;
}

static struct gyro_xz_rec pending;
static struct k_spinlock pending_lock;

static void save_work_fn(struct k_work *w)
{
	struct gyro_xz_rec rec;
	K_SPINLOCK(&pending_lock) {
		rec = pending;
	}
	if (mount() == 0) {
		ssize_t r = zms_write(&fs, ID_GYRO_XZ, &rec, sizeof(rec));

		if (r < 0) {
			LOG_ERR("saving gyro calibration failed (%d)", (int)r);
		}
	}
}
static K_WORK_DEFINE(save_work, save_work_fn);

void calib_save_xz(const struct xz_learn *l)
{
	K_SPINLOCK(&pending_lock) {
		pending = (struct gyro_xz_rec){.ver = GYRO_XZ_VER, .n = l->n, .k = {l->k[0], l->k[1]}};
	}
	k_work_submit(&save_work);
}
