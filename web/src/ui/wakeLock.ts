/**
 * Keeps the screen on while a disc is connected (Screen Wake Lock API). On a phone the page would
 * otherwise sleep, and Chrome drops the Bluetooth link soon after. The browser releases the lock
 * whenever the page is hidden, so it is taken again when the page comes back.
 * Browsers without the API (or that refuse, e.g. in battery saver) just let the screen sleep.
 */
let wanted = false;
let lock: WakeLockSentinel | null = null;
let pending = false;

async function acquire() {
  if (!wanted || lock || pending || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  pending = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
    if (!wanted) await release(); // disconnected while the request was in flight
  } catch {
    lock = null;
  } finally {
    pending = false;
  }
}

async function release() {
  const l = lock;
  lock = null;
  await l?.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => void acquire());

export function keepAwake(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  void (on ? acquire() : release());
}
