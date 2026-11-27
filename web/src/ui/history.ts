import type { Settings, ThrowRecord, ThrowStore } from '../store/throws';
import { fmtDist, fmtSpeed } from '../units';
import { h } from './dom';

export class HistoryPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  readonly ghosts = new Set<string>();
  selected?: string;
  /** The card's header, for extra buttons. */
  readonly head: HTMLElement;
  /** When the current session began; throws before it are listed under "Earlier". */
  session?: () => number;

  constructor(
    private store: ThrowStore,
    private settings: () => Settings,
    private onReplay: (r: ThrowRecord) => void,
    private onGhosts: () => void,
  ) {
    this.list = h('ol.history');
    const exportBtn = h('button.ghostbtn', { type: 'button', onclick: () => this.export() }, 'Export');
    const clearBtn = h('button.ghostbtn', {
      type: 'button',
      onclick: () => {
        if (clearBtn.dataset.armed) {
          this.store.clear();
          this.ghosts.clear();
          this.onGhosts();
        } else {
          clearBtn.dataset.armed = '1';
          clearBtn.textContent = 'Really clear?';
          setTimeout(() => {
            delete clearBtn.dataset.armed;
            clearBtn.textContent = 'Clear';
          }, 2500);
        }
      },
    }, 'Clear');
    this.head = h('div.cardhead', {}, h('h2', {}, 'Throws'), exportBtn, clearBtn);
    this.el = h('section.card.historycard', {}, this.head, this.list);
    store.onChange = () => this.render();
    this.render();
  }

  render() {
    const units = this.settings().units;
    const items = this.store.all();
    if (!items.length) {
      this.list.replaceChildren(h('li.empty', {}, 'No throws yet. Press Throw, or connect a disc.'));
      return;
    }
    const since = this.session?.();
    const inSession = since === undefined ? items.length : items.findIndex((r) => r.ts < since);
    const nSession = inSession < 0 ? items.length : inSession;
    this.list.replaceChildren(
      ...(since !== undefined ? [h('li.divider', {}, nSession ? `This session · ${nSession} throw${nSession === 1 ? '' : 's'}` : 'No throws this session yet')] : []),
      ...items.flatMap((r, i) => {
        const li = this.item(r, units);
        return since !== undefined && i === nSession ? [h('li.divider', {}, 'Earlier'), li] : [li];
      }),
    );
  }

  private item(r: ThrowRecord, units: Settings['units']): HTMLElement {
    const p = r.params;
    const lat = r.summary.lateral;
    const ghost = h('input', { type: 'checkbox', title: 'Show path', 'aria-label': 'Show path', checked: this.ghosts.has(r.id) });
    ghost.addEventListener('change', () => {
      if (ghost.checked) this.ghosts.add(r.id);
      else this.ghosts.delete(r.id);
      this.onGhosts();
    });
    const actual = h('input.actual', { type: 'number', min: 0, step: 1, placeholder: 'actual', title: 'Measured distance (m), for calibrating the model', value: r.actualDistance ?? '' });
    actual.addEventListener('change', () => this.store.update(r.id, { actualDistance: actual.value === '' ? undefined : Number(actual.value) }));
    const del = h('button.x', { type: 'button', title: 'Delete', 'aria-label': 'Delete throw', onclick: (e: Event) => {
      e.stopPropagation();
      this.ghosts.delete(r.id);
      this.store.remove(r.id);
      this.onGhosts();
    } }, '×');
    const li = h(
      'li',
      { class: r.id === this.selected ? 'sel' : undefined, onclick: (e: Event) => {
        if ((e.target as HTMLElement).closest('input,button')) return;
        this.selected = r.id;
        this.onReplay(r);
        this.render();
      } },
      h('span.swatch', { style: `background:${r.disc.color}` }),
      h('div.main', {},
        h('div.top', {},
          h('b', {}, fmtDist(r.summary.distance, units)),
          h('span.lat', {}, Math.abs(lat) < 1 ? 'centre' : `${fmtDist(Math.abs(lat), units)} ${lat > 0 ? 'L' : 'R'}`),
          r.source === 'disc' ? h('span.tag', { title: r.anglesEstimated ? 'From the disc (angles estimated)' : 'From the disc' }, r.anglesEstimated ? 'disc*' : 'disc') : null,
        ),
        h('div.sub', {}, `${r.disc.name} · ${fmtSpeed(p.speed, units)} · ${Math.round(p.spinRpm)} rpm · hyz ${p.hyzerDeg.toFixed(0)}° · nose ${p.noseDeg.toFixed(0)}° · ${p.hand}H${p.style}`),
        h('div.sub', {}, new Date(r.ts).toLocaleString()),
      ),
      h('div.tools', {}, ghost, actual, del),
    );
    return li;
  }

  private export() {
    const blob = new Blob([this.store.exportJson()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `discyboi-throws-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
