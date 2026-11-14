/** Builds a history record from a throw the disc reported. */
import type { ThrowResult } from '../ble/protocol';
import { convertResult, type Mount } from '../sim/convert';
import { simulate } from '../sim/flight';
import type { DiscSpec, FlightResult, Hand, ThrowParams } from '../sim/types';
import { summarize, type ThrowRecord } from './throws';

export interface DiscThrow {
  rec: Omit<ThrowRecord, 'id' | 'ts'>;
  params: ThrowParams;
  flight?: FlightResult;
}

/** Without a valid speed the release angles are still recorded, but no flight is simulated. */
export function discThrow(r: ThrowResult, disc: DiscSpec, opt: { hand: Hand; mount: Mount; extra?: Partial<ThrowParams> }): DiscThrow {
  const c = convertResult(r, { hand: opt.hand, mount: opt.mount });
  const params: ThrowParams = { ...c.params, headingDeg: 0, ...opt.extra };
  const flight = c.speedValid ? simulate(params, disc) : undefined;
  return {
    params,
    flight,
    rec: {
      source: 'disc',
      disc,
      params,
      raw: r,
      anglesEstimated: !c.anglesValid,
      noSim: !flight,
      summary: flight ? summarize(flight) : { distance: 0, carry: 0, lateral: 0, apex: 0, flightTime: 0 },
    },
  };
}
