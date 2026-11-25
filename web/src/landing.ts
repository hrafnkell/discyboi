/** Landing page: click an image to see it full size. Arrow keys / buttons step through, Esc or a click outside closes. */
const box = document.querySelector<HTMLDialogElement>('dialog.lightbox')!;
const big = box.querySelector('img')!;
const cap = box.querySelector<HTMLElement>('.lb-cap')!;
const imgs = [...document.querySelectorAll<HTMLImageElement>('main img[data-full]')];
let cur = 0;

function show(i: number) {
  cur = (i + imgs.length) % imgs.length;
  const src = imgs[cur];
  big.src = src.dataset.full!;
  big.alt = src.alt;
  // A figure's caption says more than the alt text; fall back to the alt text.
  cap.textContent = src.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || src.alt;
  if (!box.open) box.showModal();
}

imgs.forEach((im, i) => {
  im.tabIndex = 0;
  im.setAttribute('role', 'button');
  im.addEventListener('click', () => show(i));
  im.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show(i);
    }
  });
});

box.querySelector('.lb-prev')!.addEventListener('click', () => show(cur - 1));
box.querySelector('.lb-next')!.addEventListener('click', () => show(cur + 1));
box.querySelector('.lb-close')!.addEventListener('click', () => box.close());
// Clicks on the dark area (the dialog itself, not the image or buttons) close it.
box.addEventListener('click', (e) => {
  if (e.target === box || e.target === cap) box.close();
});
box.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') show(cur - 1);
  else if (e.key === 'ArrowRight') show(cur + 1);
});
// Swipe on touch screens.
let x0: number | undefined;
box.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
box.addEventListener('touchend', (e) => {
  if (x0 === undefined) return;
  const dx = e.changedTouches[0].clientX - x0;
  x0 = undefined;
  if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
});
box.addEventListener('close', () => big.removeAttribute('src'));

// ---------------------------------------------------------------- "want a board?" form
const form = document.querySelector<HTMLFormElement>('form.interest-form');
if (form) {
  const status = form.querySelector<HTMLElement>('.status')!;
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const say = (msg: string, kind?: 'ok' | 'err') => {
    status.textContent = msg;
    status.className = kind ? `status ${kind}` : 'status';
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!d.name?.trim()) return say('Please enter your name.', 'err');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email?.trim() ?? '')) return say('Please enter a valid email address.', 'err');
    btn.disabled = true;
    say('Sending…');
    try {
      const res = await fetch('/api/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const r = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !r.ok) throw new Error(r.error ?? `Something went wrong (${res.status}).`);
      form.reset();
      say("Thanks! You're on the list. I'll be in touch if boards get made.", 'ok');
    } catch (err) {
      say(err instanceof Error && !/fetch|network/i.test(err.message) ? err.message : "Couldn't send. Check your connection, or email info@discyboi.com.", 'err');
    } finally {
      btn.disabled = false;
    }
  });
}
