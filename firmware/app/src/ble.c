/*
 * BLE: Battery Service + the discyboi service.
 *
 * discyboi service  6d2b0001-5f3c-4b8a-9e0d-d15cb0100000
 *   Throw   ...0002  read, notify   struct throw_result (26 bytes), the latest throw
 *   Status  ...0003  read, notify   struct status (8 bytes)
 *   Control ...0004  write          1 byte opcode (see enum ctrl_op)
 *   Data    ...0005  notify         raw capture download (see send_capture())
 *   Info    ...0006  read           firmware version string, "0.2.0+<git commit>"
 */
#include <app_version.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>

#include <zephyr/drivers/hwinfo.h>

#include "discy.h"

LOG_MODULE_REGISTER(ble, LOG_LEVEL_INF);

#define UUID_DISCY(n) BT_UUID_128_ENCODE(0x6d2b0000 + (n), 0x5f3c, 0x4b8a, 0x9e0d, 0xd15cb0100000)

static const struct bt_uuid_128 uuid_svc = BT_UUID_INIT_128(UUID_DISCY(1));
static const struct bt_uuid_128 uuid_throw = BT_UUID_INIT_128(UUID_DISCY(2));
static const struct bt_uuid_128 uuid_status = BT_UUID_INIT_128(UUID_DISCY(3));
static const struct bt_uuid_128 uuid_ctrl = BT_UUID_INIT_128(UUID_DISCY(4));
static const struct bt_uuid_128 uuid_data = BT_UUID_INIT_128(UUID_DISCY(5));
static const struct bt_uuid_128 uuid_info = BT_UUID_INIT_128(UUID_DISCY(6));
static const struct bt_uuid_128 uuid_board = BT_UUID_INIT_128(UUID_DISCY(7));

/* build.sh writes build_id.h with the git commit the image was built from. */
#if __has_include("build_id.h")
#include "build_id.h"
#else
#define DISCY_BUILD_ID "local"
#endif
const char discy_fw_version[] = APP_VERSION_STRING "+" DISCY_BUILD_ID;

static ssize_t read_info(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			 uint16_t len, uint16_t offset)
{
	return bt_gatt_attr_read(conn, attr, buf, len, offset, discy_fw_version,
				 sizeof(discy_fw_version) - 1);
}

/* The chip's factory-unique ID (8 bytes), so the lab can tell boards apart. The lab hashes it
 * before it goes anywhere. */
static ssize_t read_board_id(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			     uint16_t len, uint16_t offset)
{
	uint8_t id[8] = {0};
	ssize_t n = hwinfo_get_device_id(id, sizeof(id));

	if (n < 0) {
		n = 0;
	}
	return bt_gatt_attr_read(conn, attr, buf, len, offset, id, (uint16_t)n);
}

enum ctrl_op {
	CTRL_DOWNLOAD = 0x01,  /* send the last capture on Data */
	CTRL_ABORT = 0x02,     /* stop a running download */
	CTRL_IDENTIFY = 0x10,  /* blink the LED */
};

/* Data characteristic packets. All little-endian. */
enum data_type {
	DATA_HEADER = 0x00,
	DATA_SAMPLES = 0x01,
	DATA_END = 0x02,
};

struct data_header {
	uint8_t type;           /* DATA_HEADER */
	uint8_t version;        /* 1 */
	uint16_t sample_size;   /* bytes per sample (30) */
	uint32_t throw_id;
	uint16_t len;           /* number of samples */
	uint16_t pull_idx;
	uint16_t release_idx;
	uint16_t odr_hz;
	uint32_t rim_radius_um;
	float gyro_dps_per_lsb;
	float acc_g_per_lsb;
	float hg_g_per_lsb;
} __packed;

/* DATA_SAMPLES: u8 type, u8 count, u16 first index, then count * struct sample.
 * DATA_END:     u8 type, u8 status (0 = complete, 1 = aborted), u16 samples sent. */

struct status {
	uint8_t state;          /* enum capture_state */
	uint8_t downloading;
	uint16_t battery_mv;
	uint32_t throws;
} __packed;

static struct throw_result last_result;
static struct bt_conn *current;
static bool downloading;
static atomic_t abort_dl;
static K_SEM_DEFINE(dl_sem, 0, 1);

static ssize_t read_throw(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			  uint16_t len, uint16_t offset)
{
	return bt_gatt_attr_read(conn, attr, buf, len, offset, &last_result, sizeof(last_result));
}

static void fill_status(struct status *s)
{
	*s = (struct status){
		.state = capture_state(),
		.downloading = downloading,
		.battery_mv = battery_mv(),
		.throws = capture_throw_count(),
	};
}

static ssize_t read_status(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			   uint16_t len, uint16_t offset)
{
	struct status s;

	fill_status(&s);
	return bt_gatt_attr_read(conn, attr, buf, len, offset, &s, sizeof(s));
}

static ssize_t write_ctrl(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf,
			  uint16_t len, uint16_t offset, uint8_t flags)
{
	if (offset != 0 || len < 1) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
	}
	switch (((const uint8_t *)buf)[0]) {
	case CTRL_DOWNLOAD:
		if (downloading) {
			return BT_GATT_ERR(BT_ATT_ERR_PROCEDURE_IN_PROGRESS);
		}
		atomic_set(&abort_dl, 0);
		k_sem_give(&dl_sem);
		break;
	case CTRL_ABORT:
		atomic_set(&abort_dl, 1);
		break;
	case CTRL_IDENTIFY:
		led_blink(5);
		break;
	default:
		return BT_GATT_ERR(BT_ATT_ERR_NOT_SUPPORTED);
	}
	return len;
}

BT_GATT_SERVICE_DEFINE(discy_svc,
	BT_GATT_PRIMARY_SERVICE(&uuid_svc),
	BT_GATT_CHARACTERISTIC(&uuid_throw.uuid, BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
			       BT_GATT_PERM_READ, read_throw, NULL, NULL),
	BT_GATT_CCC(NULL, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
	BT_GATT_CHARACTERISTIC(&uuid_status.uuid, BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
			       BT_GATT_PERM_READ, read_status, NULL, NULL),
	BT_GATT_CCC(NULL, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
	BT_GATT_CHARACTERISTIC(&uuid_ctrl.uuid, BT_GATT_CHRC_WRITE | BT_GATT_CHRC_WRITE_WITHOUT_RESP,
			       BT_GATT_PERM_WRITE, NULL, write_ctrl, NULL),
	BT_GATT_CHARACTERISTIC(&uuid_data.uuid, BT_GATT_CHRC_NOTIFY, BT_GATT_PERM_NONE, NULL, NULL,
			       NULL),
	BT_GATT_CCC(NULL, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
	/* New characteristics go at the end: the ATTR_ indices below must not move. */
	BT_GATT_CHARACTERISTIC(&uuid_info.uuid, BT_GATT_CHRC_READ, BT_GATT_PERM_READ, read_info, NULL,
			       NULL),
	BT_GATT_CHARACTERISTIC(&uuid_board.uuid, BT_GATT_CHRC_READ, BT_GATT_PERM_READ, read_board_id,
			       NULL, NULL),
);

/* Attribute indices in discy_svc.attrs */
#define ATTR_THROW  2
#define ATTR_STATUS 5
#define ATTR_DATA   10

void ble_publish_result(const struct throw_result *r)
{
	last_result = *r;
	if (current) {
		bt_gatt_notify(current, &discy_svc.attrs[ATTR_THROW], r, sizeof(*r));
	}
}

void ble_publish_status(void)
{
	struct status s;

	if (!current) {
		return;
	}
	fill_status(&s);
	bt_gatt_notify(current, &discy_svc.attrs[ATTR_STATUS], &s, sizeof(s));
}

/* Notify, waiting for TX buffers instead of dropping packets. */
static int notify_data(struct bt_conn *conn, const void *data, uint16_t len)
{
	while (true) {
		int err = bt_gatt_notify(conn, &discy_svc.attrs[ATTR_DATA], data, len);

		if (err != -ENOMEM) {
			return err;
		}
		k_msleep(2);
	}
}

static void send_capture(struct bt_conn *conn)
{
	struct capture_view cap;
	uint8_t pkt[244];
	uint16_t sent = 0;
	int err;

	if (!bt_gatt_is_subscribed(conn, &discy_svc.attrs[ATTR_DATA], BT_GATT_CCC_NOTIFY)) {
		LOG_WRN("download requested without subscribing to Data");
		return;
	}
	if (!capture_lock(&cap)) {
		pkt[0] = DATA_END;
		pkt[1] = 2; /* nothing to send / busy */
		sys_put_le16(0, &pkt[2]);
		notify_data(conn, pkt, 4);
		return;
	}
	downloading = true;
	ble_publish_status();

	struct data_header h = {
		.type = DATA_HEADER,
		.version = 1,
		.sample_size = sizeof(struct sample),
		.throw_id = cap.throw_id,
		.len = cap.len,
		.pull_idx = cap.pull_idx,
		.release_idx = cap.release_idx,
		.odr_hz = IMU_ACTIVE_HZ,
		.rim_radius_um = (uint32_t)(cap.rim_radius_m * 1e6f),
		.gyro_dps_per_lsb = IMU_GYRO_DPS_PER_LSB,
		.acc_g_per_lsb = IMU_ACC_G_PER_LSB,
		.hg_g_per_lsb = IMU_HG_G_PER_LSB,
	};
	err = notify_data(conn, &h, sizeof(h));

	/* Samples per packet from the negotiated ATT MTU (3 bytes notify header, 4 bytes ours). */
	uint16_t per = MIN((bt_gatt_get_mtu(conn) - 3 - 4) / sizeof(struct sample),
			   (sizeof(pkt) - 4) / sizeof(struct sample));

	per = MAX(per, 1);
	while (!err && sent < cap.len && !atomic_get(&abort_dl)) {
		uint8_t n = MIN(per, cap.len - sent);

		pkt[0] = DATA_SAMPLES;
		pkt[1] = n;
		sys_put_le16(sent, &pkt[2]);
		for (int i = 0; i < n; i++) {
			memcpy(&pkt[4 + i * sizeof(struct sample)], capture_get(sent + i),
			       sizeof(struct sample));
		}
		err = notify_data(conn, pkt, 4 + n * sizeof(struct sample));
		sent += n;
	}
	pkt[0] = DATA_END;
	pkt[1] = sent == cap.len ? 0 : 1;
	sys_put_le16(sent, &pkt[2]);
	if (!err) {
		notify_data(conn, pkt, 4);
	}
	capture_unlock();
	downloading = false;
	ble_publish_status();
	LOG_INF("download of throw %u: %u/%u samples%s", cap.throw_id, sent, cap.len,
		err ? " (link error)" : "");
}

static void download_thread(void *a, void *b, void *c)
{
	while (true) {
		k_sem_take(&dl_sem, K_FOREVER);
		struct bt_conn *conn = current ? bt_conn_ref(current) : NULL;

		if (conn) {
			send_capture(conn);
			bt_conn_unref(conn);
		}
	}
}
K_THREAD_DEFINE(dl_tid, 2048, download_thread, NULL, NULL, NULL, K_PRIO_PREEMPT(8), 0, 0);

/* ---- advertising + connection management ---- */

static const struct bt_data ad[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME, sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};
static const struct bt_data sd[] = {
	BT_DATA_BYTES(BT_DATA_UUID128_ALL, UUID_DISCY(1)),
};

static void adv_work_handler(struct k_work *work)
{
	/* ~0.5-0.6 s interval: findable within a second or two without costing much power. */
	int err = bt_le_adv_start(BT_LE_ADV_PARAM(BT_LE_ADV_OPT_CONN, 800, 960, NULL), ad,
				  ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));

	if (err && err != -EALREADY) {
		LOG_ERR("advertising failed (%d)", err);
	}
}
static K_WORK_DEFINE(adv_work, adv_work_handler);

/* Ask for long packets and the 2M PHY a moment after connecting, not straight away: right after
 * connecting, Android is exchanging MTU and discovering services (and often asks for the same
 * itself), and some Android stacks drop the link when these procedures overlap. */
static void link_upgrade_fn(struct k_work *w)
{
	struct bt_conn *conn = current ? bt_conn_ref(current) : NULL;

	if (!conn) {
		return;
	}
	bt_conn_le_data_len_update(conn, BT_LE_DATA_LEN_PARAM_MAX);
	bt_conn_le_phy_update(conn, BT_CONN_LE_PHY_PARAM_2M);
	bt_conn_unref(conn);
}
static K_WORK_DELAYABLE_DEFINE(link_upgrade, link_upgrade_fn);

static void connected(struct bt_conn *conn, uint8_t err)
{
	if (err) {
		return;
	}
	current = bt_conn_ref(conn);
	LOG_INF("connected");
	k_work_reschedule(&link_upgrade, K_MSEC(1500));
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
	LOG_INF("disconnected (0x%02x)", reason);
	k_work_cancel_delayable(&link_upgrade);
	atomic_set(&abort_dl, 1);
	if (current) {
		bt_conn_unref(current);
		current = NULL;
	}
}

static void recycled(void)
{
	k_work_submit(&adv_work);
}

BT_CONN_CB_DEFINE(conn_cb) = {
	.connected = connected,
	.disconnected = disconnected,
	.recycled = recycled,
};

int ble_init(void)
{
	int err = bt_enable(NULL);

	if (err) {
		return err;
	}
	k_work_submit(&adv_work);
	return 0;
}
