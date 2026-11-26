/*
 * Run analysis.c on raw captures saved by the web app ("Save raw data": a 32-byte header
 * followed by 30-byte samples), to try analysis changes against real throws.
 *   make -C test replay && test/replay throw1.bin throw2.bin ...
 *
 * Files are taken in the order given (oldest first) and the gyro cross-axis coupling is learned
 * across them as the disc does. Options (before the files):
 *   -n          no cross-axis correction (the old behaviour)
 *   -k kx,ky    use this coupling for every throw instead of learning it
 */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#include "discy.h"

static struct sample buf[CAPTURE_LEN];
const struct sample *capture_get(uint16_t i) { return &buf[i]; }

static unsigned u16(const unsigned char *p) { return p[0] | p[1] << 8; }

int main(int argc, char **argv)
{
	int f = 1, mode = 'l'; /* l = learn, n = none, k = fixed */
	float fixed[2] = {0};
	struct xz_learn xz = {0};

	for (; f < argc && argv[f][0] == '-'; f++) {
		if (!strcmp(argv[f], "-n")) {
			mode = 'n';
		} else if (!strcmp(argv[f], "-k") && f + 1 < argc &&
			   sscanf(argv[++f], "%f,%f", &fixed[0], &fixed[1]) == 2) {
			mode = 'k';
		} else {
			fprintf(stderr, "usage: replay [-n | -k kx,ky] file.bin ...\n");
			return 2;
		}
	}
	for (; f < argc; f++) {
		unsigned char h[32];
		FILE *fp = fopen(argv[f], "rb");

		if (!fp || fread(h, 1, sizeof(h), fp) != sizeof(h) || u16(h + 2) != sizeof(struct sample)) {
			fprintf(stderr, "%s: not a capture file\n", argv[f]);
			return 1;
		}
		struct capture_view cap = {.throw_id = h[4] | h[5] << 8 | h[6] << 16 | (unsigned)h[7] << 24,
					   .len = u16(h + 8), .pull_idx = u16(h + 10),
					   .release_idx = u16(h + 12), .rim_radius_m = 0.009f};

		if (cap.len > CAPTURE_LEN || fread(buf, sizeof(struct sample), cap.len, fp) != cap.len) {
			fprintf(stderr, "%s: truncated\n", argv[f]);
			return 1;
		}
		fclose(fp);

		struct throw_result r = {0};
		float k[2];
		bool got = analysis_gyro_xz(&cap, k);

		if (mode == 'k') {
			cap.gyro_xz[0] = fixed[0];
			cap.gyro_xz[1] = fixed[1];
		} else if (mode == 'l' && xz_learn_ready(&xz)) {
			cap.gyro_xz[0] = xz.k[0];
			cap.gyro_xz[1] = xz.k[1];
		}
		analysis_run(&cap, &r);
		if (got) {
			xz_learn_add(&xz, k);
		}
		printf("%-24s #%-3u flags 0x%02x  speed %5.2f  hyzer %6.2f  nose %6.2f  launch %6.2f  spin %5d  wobble %4u  "
		       "xz used %+.4f %+.4f",
		       argv[f], (unsigned)cap.throw_id, r.flags, r.speed_cms / 100.0, r.hyzer_cdeg / 100.0,
		       r.nose_cdeg / 100.0, r.launch_cdeg / 100.0, r.spin_rpm, r.wobble_dps, cap.gyro_xz[0],
		       cap.gyro_xz[1]);
		if (got) {
			printf("  this throw %+.4f %+.4f", k[0], k[1]);
		}
		printf("%s\n", (r.flags & RESULT_REF_APPROX) ? "  [approx]" : "");
	}
	return 0;
}
