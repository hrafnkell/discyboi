import './style.css';
import * as THREE from 'three';
import { FLAG_REF_APPROX, noSpeedReason, type ThrowResult } from './ble/protocol';
import { CAM_MODES, CameraRig, type CamMode } from './scene/cameras';
import { AimLine } from './scene/aimLine';
import { updateLabels } from './scene/labels';
import { FlightView } from './scene/playback';
import { ReleasePreview } from './scene/preview';
import { practiceField, World } from './scene/world';
import { convertResult } from './sim/convert';
import { simulate } from './sim/flight';
import type { DiscSpec, FlightResult, ThrowParams } from './sim/types';
import { discThrow } from './store/record';
import { loadSettings, saveSettings, sessionStart, setSessionStart, summarize, ThrowStore, type ThrowRecord } from './store/throws';
import { AccountPanel } from './ui/accountPanel';
import { DevicePanel } from './ui/devicePanel';
import { DiscPicker } from './ui/discPicker';
import { h, section, segmented, slider } from './ui/dom';
import { distScale, fmtDist, fmtSpeed, UNIT_OPTIONS, type Units } from './units';
import { HistoryPanel } from './ui/history';
import { StatsBar } from './ui/stats';
import { ThrowPanel } from './ui/throwPanel';

const settings = loadSettings();
const fake = new URLSearchParams(location.search).has('fake');

// ---------------------------------------------------------------- 3D
const app = document.getElementById('app')!;
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
  app.append(h('div.nogl', {}, h('h1', {}, 'WebGL is not available'),
    h('p', {}, 'The 3D flight view needs WebGL. Enable hardware acceleration in your browser settings (or chrome://settings/system) and reload.')));
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.append(renderer.domElement);
const scene = new THREE.Scene();
const world = new World(scene, renderer);
const hole = () => practiceField(settings.basketDist);
world.setHole(hole());
world.setUnits(settings.units);
const view = new FlightView(scene);
const aimLine = new AimLine(scene);
view.fmt = (m) => fmtDist(m, settings.units);
const rig = new CameraRig(renderer.domElement);

// ---------------------------------------------------------------- UI
const stats = new StatsBar();
stats.units = settings.units;
const store = new ThrowStore();
const toasts = h('div.toasts', { 'aria-live': 'polite' });
const toast = (msg: string, kind?: 'err') => {
  const t = h('div.toast', { class: kind === 'err' ? 'toast err' : 'toast' }, msg);
  toasts.append(t);
  setTimeout(() => t.remove(), 4000);
};

const preview = new ReleasePreview();
const updatePreview = () => preview.update(panel.current(), picker.get());
const picker = new DiscPicker('drv-stable', () => updatePreview());
const panel = new ThrowPanel(() => doThrow(), () => {
  settings.hand = panel.params.hand;
  saveSettings(settings);
  updatePreview();
}, () => settings.units);
panel.set({ ...panel.params, hand: settings.hand });
panel.previewSlot.append(preview.el);

const ghostCache = new Map<string, FlightResult>();
const history = new HistoryPanel(store, () => settings, (r) => replay(r), () => refreshGhosts());
history.session = sessionStart;
// Throws arriving from elsewhere (the account's other devices) join the session traces too.
{
  const render = store.onChange;
  store.onChange = (kind) => {
    render?.(kind);
    if (settings.sessionTraces) refreshGhosts();
  };
}

/** Starts a new practice session: shared with the throws page and, signed in, the account's other devices. */
function newSession(t = Date.now(), share = true) {
  setSessionStart(t);
  if (share) store.setPrefs({ sessionStart: t });
  history.render();
  refreshGhosts();
}
history.head.append(h('button.ghostbtn', { type: 'button', title: 'Only count throws from now on', onclick: () => {
  newSession();
  toast('New session started');
} }, 'New session'));

const device = new DevicePanel(fake, (r) => onDiscThrow(r), toast);
const account = new AccountPanel(store, toast);

const camSeg = segmented<CamMode>(CAM_MODES, rig.mode, (m) => rig.setMode(m));
rig.onAim = (d) => panel.nudgeAim(d);

/** Shows everything in the chosen units. `share` also tells the account's other devices. */
function setUnits(u: Units, share: boolean) {
  settings.units = u;
  saveSettings(settings);
  if (share) store.setPrefs({ units: u });
  unitsSeg.set(u);
  stats.show(view.current, u);
  view.refreshLabel();
  world.setUnits(u);
  history.render();
  if (view.current) showThrowLine(panel.current());
  panel.refreshUnits();
  basket.refresh();
}
const unitsSeg = segmented<Units>(UNIT_OPTIONS, settings.units, (u) => setUnits(u, true));
// Signed in, units are an account setting: a change on another device (or the stored one at sign-in) applies here.
store.onPrefs = (p) => {
  if (p.units && p.units !== settings.units) setUnits(p.units, false);
  if (p.sessionStart !== undefined && p.sessionStart !== sessionStart()) newSession(p.sessionStart, false);
};
const mountSeg = segmented<'faceUp' | 'faceDown'>(
  [{ id: 'faceUp', label: 'Face up', title: 'Board top faces the top of the disc' }, { id: 'faceDown', label: 'Face down', title: 'Board top faces the bottom of the disc' }],
  settings.mount,
  (m) => {
    settings.mount = m;
    saveSettings(settings);
  },
);
const basket = slider({
  label: 'Basket', min: 20, max: 250, step: 5, value: settings.basketDist,
  scale: () => ({ ...distScale(settings.units), step: settings.units === 'imperial' ? 10 : 5 }),
  onInput: (v) => {
    settings.basketDist = v;
    saveSettings(settings);
    world.setHole(hole());
  },
});
const tracesSeg = segmented<'off' | 'on'>(
  [{ id: 'off', label: 'Off' }, { id: 'on', label: 'On', title: 'Draw the path of every throw since New session' }],
  settings.sessionTraces ? 'on' : 'off',
  (v) => {
    settings.sessionTraces = v === 'on';
    saveSettings(settings);
    refreshGhosts();
  },
);
const settingsCard = section('Settings',
  h('div.setrow', {}, h('span', {}, 'Units'), unitsSeg.el),
  h('div.setrow', {}, h('span', { title: 'Every throw since New session, drawn faintly behind the current one' }, 'Session traces'), tracesSeg.el),
  h('div.setrow', {}, h('span', {}, 'Board mount'), mountSeg.el),
  basket.el,
);

// Playback bar
const playBtn = h('button.play', { type: 'button', 'aria-label': 'Play / pause', onclick: () => togglePlay() }, '▶');
const scrub = h('input.scrub', { type: 'range', min: 0, max: 1, step: 0.001, value: 0, 'aria-label': 'Flight time' });
scrub.addEventListener('input', () => {
  view.playing = false;
  view.t = Number(scrub.value) * view.duration;
  view.update(0);
});
const rateSel = h('select.rate', { 'aria-label': 'Playback speed', onchange: () => (view.rate = Number(rateSel.value)) },
  ...[0.25, 0.5, 1, 2].map((r) => h('option', { value: r, selected: r === 1 }, `${r}×`)));
const playbar = h('div.playbar', {}, playBtn, scrub, rateSel);
// The throw's own numbers, for when the throw panel is out of the way (always, on a phone).
const throwLine = h('div.throwline', { 'aria-live': 'polite' });
function showThrowLine(p: ThrowParams) {
  const cell = (v: string, k: string) => h('span', {}, h('b', {}, v), ` ${k}`);
  throwLine.replaceChildren(
    cell(fmtSpeed(p.speed, settings.units), ''),
    cell(`${Math.round(p.spinRpm)}`, 'rpm'),
    cell(`${p.hyzerDeg >= 0 ? '' : '−'}${Math.abs(p.hyzerDeg).toFixed(0)}°`, p.hyzerDeg >= 0 ? 'hyzer' : 'anhyzer'),
    cell(`${p.noseDeg >= 0 ? '+' : '−'}${Math.abs(p.noseDeg).toFixed(0)}°`, 'nose'),
    cell(`${p.launchDeg.toFixed(0)}°`, 'launch'),
    h('span.style', {}, `${p.hand}H${p.style}`),
  );
}

const leftToggle = h('button.paneltoggle.left', { type: 'button', 'aria-label': 'Toggle throw panel', onclick: () => document.body.classList.toggle('hide-left') }, '☰');
const rightToggle = h('button.paneltoggle.right', { type: 'button', 'aria-label': 'Toggle history', onclick: () => document.body.classList.toggle('hide-right') }, '⟲');

document.body.append(
  h('header.topbar', {}, leftToggle, h('a.brand', { href: '../', title: 'About discyboi' }, h('span.logo'), 'discyboi', h('small', {}, fake ? 'flight lab · fake disc' : 'flight lab')),
    h('a.ghostbtn.navlink', { href: `./throws.html${fake ? '?fake=1' : ''}`, title: 'Throw history, stats and compare' }, 'Throws →'), camSeg.el, device.el, account.el, rightToggle),
  h('aside.panel.leftpanel', {}, picker.el, panel.el),
  h('aside.panel.rightpanel', {}, history.el, settingsCard),
  h('div.bottom', {}, throwLine, stats.el, playbar),
  toasts,
);
if (innerWidth < 900) document.body.classList.add('hide-right');
// On a phone the throw panel covers the view: start with it closed (the numbers strip shows the throw).
if (innerWidth <= 760) document.body.classList.add('hide-left');

// ---------------------------------------------------------------- actions
function play(flight: FlightResult, disc: DiscSpec, params: ThrowParams = panel.current()) {
  view.load(flight, disc);
  rig.reset();
  stats.show(flight, settings.units);
  showThrowLine(params);
}

function record(disc: DiscSpec, flight: FlightResult, extra: Partial<ThrowRecord> & { source: ThrowRecord['source'] }) {
  const rec = store.add({ disc, params: panel.current(), summary: summarize(flight), ...extra });
  history.selected = rec.id;
  ghostCache.set(rec.id, flight);
  history.render();
  if (settings.sessionTraces) refreshGhosts();
}

function doThrow() {
  const disc = picker.get();
  const params = panel.current();
  const flight = simulate(params, disc);
  play(flight, disc);
  record(disc, flight, { source: 'manual', params });
  if (innerWidth <= 760) document.body.classList.add('hide-left'); // show the flight on phones
}

const styleName = (s: 'BH' | 'FH') => (s === 'BH' ? 'backhand' : 'forehand');

function onDiscThrow(r: ThrowResult) {
  const c = convertResult(r, { hand: panel.params.hand, mount: settings.mount });
  if (!c.speedValid) {
    // Keep the release angles for the history page, but there's nothing to fly.
    const t = discThrow(r, picker.get(), { hand: panel.params.hand, mount: settings.mount });
    store.add(t.rec);
    panel.set({ ...panel.params, style: c.params.style }); // spin direction is still known
    updatePreview();
    toast(`Throw #${r.throwId} (${styleName(c.params.style)}, ${Math.round(c.params.spinRpm)} rpm): no speed, ${noSpeedReason(r.flags)}`, 'err');
    return;
  }
  panel.set({ ...c.params, headingDeg: 0 });
  updatePreview();
  const disc = picker.get();
  const params = panel.current();
  const flight = simulate(params, disc);
  play(flight, disc);
  record(disc, flight, { source: 'disc', params, raw: r, anglesEstimated: !c.anglesValid });
  if (innerWidth <= 760) document.body.classList.add('hide-left'); // show the flight on phones
  const note = !c.anglesValid ? ' (no still moment: angles estimated)' : r.flags & FLAG_REF_APPROX ? ' (disc not held still: approximate)' : '';
  toast(`Throw #${r.throwId}: ${styleName(c.params.style)}, ${fmtSpeed(c.params.speed, settings.units)}, ${Math.round(c.params.spinRpm)} rpm${note}`);
}

function replay(r: ThrowRecord) {
  if (r.noSim) {
    toast('That throw has no valid speed, so there is no flight to show', 'err');
    return;
  }
  panel.set(r.params);
  updatePreview();
  const flight = ghostCache.get(r.id) ?? simulate(r.params, r.disc);
  ghostCache.set(r.id, flight);
  play(flight, r.disc, r.params);
  if (settings.sessionTraces) refreshGhosts(); // the replayed throw is drawn in full, not as a trace
}

/** Most session traces drawn at once; older ones are left out. */
const MAX_TRACES = 60;

function refreshGhosts() {
  const ids = new Set(history.ghosts);
  if (settings.sessionTraces) {
    const since = sessionStart();
    let n = 0;
    for (const r of store.all()) {
      if (r.ts < since || n >= MAX_TRACES) break; // newest first
      if (r.noSim || r.id === history.selected) continue;
      ids.add(r.id);
      n++;
    }
  }
  const list: { flight: FlightResult; color: string }[] = [];
  for (const id of ids) {
    const r = store.get(id);
    if (!r || r.noSim) continue;
    let f = ghostCache.get(id);
    if (!f) ghostCache.set(id, (f = simulate(r.params, r.disc)));
    list.push({ flight: f, color: r.disc.color });
  }
  view.setGhosts(list);
}

function togglePlay() {
  if (!view.current) return doThrow();
  if (!view.playing && view.t >= view.duration) {
    view.t = 0;
    rig.reset();
  }
  view.playing = !view.playing;
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    doThrow();
  } else if (e.key === 'r') {
    view.t = 0;
    view.playing = true;
    rig.reset();
  } else {
    const i = Number(e.key) - 1;
    if (i >= 0 && i < CAM_MODES.length) {
      camSeg.set(CAM_MODES[i].id);
      rig.setMode(CAM_MODES[i].id);
    }
  }
});

// ---------------------------------------------------------------- loop
function resize() {
  const w = app.clientWidth;
  const hgt = app.clientHeight;
  renderer.setSize(w, hgt);
  rig.camera.aspect = w / hgt;
  rig.camera.updateProjectionMatrix();
  view.setResolution(w, hgt);
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  view.update(dt);
  const pose = view.pose();
  const aim = -(panel.params.headingDeg ?? 0);
  rig.aimDeg = aim;
  aimLine.set(aim, rig.mode === 'tee');
  rig.update(pose, dt);
  if (pose) stats.live(pose.vel.length());
  playBtn.textContent = view.playing ? '❚❚' : '▶';
  if (view.duration > 0 && document.activeElement !== scrub) scrub.value = String(view.t / view.duration);
  updateLabels(rig.camera);
  renderer.render(scene, rig.camera);
});

// Start with a demo throw so the scene isn't empty.
updatePreview();
{
  const disc = picker.get();
  const f = simulate(panel.current(), disc);
  play(f, disc);
  view.playing = false;
  refreshGhosts();
}
// Opened from the throws page with ?throw=<id>: replay it.
{
  const id = new URLSearchParams(location.search).get('throw');
  const r = id ? store.get(id) : undefined;
  if (r) {
    history.selected = r.id;
    history.render();
    replay(r);
  }
}
