import { simulate } from '../src/sim/flight';
import { DISCS } from '../src/sim/discs';
import { TUNE } from '../src/sim/aero';
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));
const AOA = Number(process.env.AOA ?? -2);
const args = process.argv.slice(2);
const speeds = (process.env.SPEEDS ?? '20,22,25,27,30').split(',').map(Number);
for (const id of args.length ? args : DISCS.map(d => d.id)) {
  const disc = DISCS.find(d => d.id === id)!;
  const row = speeds.map(sp => {
    let best: any = null;
    for (const launch of [6, 9, 12, 15, 18]) {
      const r = simulate({ speed: sp, spinRpm: 700 + sp * 25, hyzerDeg: Number(process.env.HYZER ?? 0), noseDeg: launch + AOA, launchDeg: launch, hand: 'R', style: 'BH' }, disc);
      if (!best || r.distance > best.r.distance) best = { r, launch };
    }
    const r = best.r;
    let minY = 0; for (const p of r.points) minY = Math.min(minY, p.p[1]);
    return `${sp}:${r.distance.toFixed(0).padStart(4)}m@${String(best.launch).padStart(2)} y${r.lateral.toFixed(0).padStart(4)} R${minY.toFixed(0).padStart(3)} h${r.apex.toFixed(0).padStart(2)}`;
  });
  console.log(id.padEnd(18), row.join(' | '));
}
