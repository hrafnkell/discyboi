/**
 * Anonymous board count. The lab tells the server which boards it sees and how many throws they
 * make, so we know roughly how many have been built. The chip's factory ID is hashed here first,
 * so the server only ever gets an opaque 16-hex-digit id, plus the firmware version. Nothing
 * about the person is sent, and a failure is silently ignored.
 */
async function hashId(raw: ArrayBuffer): Promise<string> {
  const salt = new TextEncoder().encode('discyboi-board-v1:');
  const buf = new Uint8Array(salt.length + raw.byteLength);
  buf.set(salt);
  buf.set(new Uint8Array(raw), salt.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...h.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The board's anonymous id, or undefined if the firmware doesn't report one (or it is blank). */
export async function boardId(raw: DataView): Promise<string | undefined> {
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes.length < 4 || bytes.every((b) => b === 0) || bytes.every((b) => b === 0xff)) return undefined;
  return hashId(bytes.slice().buffer);
}

export function reportBoard(id: string, fw: string | undefined, throwId?: number) {
  try {
    void fetch(new URL('/api/board', location.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, fw: fw ?? '', ...(throwId ? { throw: throwId } : {}) }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* counting is best-effort */
  }
}
