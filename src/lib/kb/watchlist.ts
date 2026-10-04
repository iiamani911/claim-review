/**
 * Items that insurers reject every time they are billed this way. Two sources:
 *  - hospital list: items the insurance office has confirmed (seeded from WAD statements, June–July 2026);
 *  - learned: any item rejected ≥ 2 times in the payer statements currently loaded.
 */
import type { Rejection } from '../types';

export interface WatchItem {
  key: string;
  name: string;
  codes: string[];
  match: RegExp;
  problem: string;
  action: string;
  source: string;
  times?: number;
  kind: 'replace' | 'warning';
}

/** Two first meaningful words, used to match payer descriptions with HIS descriptions. */
export function itemKey(desc: string): string {
  const w = (desc || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && !['injection', 'tablet', 'capsule', 'solution', 'bottle', 'box', 'for', 'with'].includes(x));
  return w.slice(0, 2).join(' ');
}

export const HOSPITAL_WATCHLIST: WatchItem[] = [
  {
    key: 'normal saline', name: 'NS Normal Saline (100 ml / 500 ml)', codes: ['0109222573', '10-149-91'], match: /\bn\.?s\.?\s+normal saline|^normal saline/i, kind: 'replace',
    problem: 'Billed as "Normal Saline" – no agreement for this code, rejected as Out of price list (7× Tawuniya 07-2026; also refill-too-soon and drug-diagnosis rejections).',
    action: 'Replace with the contracted "Sodium Chloride 0.9%" item code before submission.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'solpadeine', name: 'Solpadeine (paracetamol + codeine + caffeine)', codes: ['0812258752'], match: /solpad[ei]*ne?/i, kind: 'warning',
    problem: 'Always rejected by the insurer.',
    action: 'Do not bill Solpadeine to insurance – prescribe a covered alternative (e.g. plain paracetamol) or bill as cash.',
    source: 'Hospital list',
  },
  {
    key: 'paracetamol parafusive', name: 'Paracetamol IV (Parafusive / Vitopeine) 10 mg/ml, 100 ml', codes: ['0901256574', '69-188-15'], match: /parafusive|vitopeine/i, kind: 'replace',
    problem: 'Rejected as Out of price list 19× (Tawuniya 07-2026).',
    action: 'Bill the contracted IV paracetamol item code instead, or confirm the code is added to the insurer price list.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'relipan', name: 'Relipan 75 mg/3 ml injection', codes: ['0201221544'], match: /relipan/i, kind: 'replace',
    problem: 'Rejected as Out of price list 5× (Tawuniya 07-2026).',
    action: 'Use the contracted diclofenac injection item code.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'divido', name: 'Divido 75 mg capsule', codes: ['0902221709'], match: /divido/i, kind: 'replace',
    problem: 'Rejected as Out of price list 4× (Tawuniya 07-2026).',
    action: 'Use the contracted diclofenac oral item code.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'ambafen', name: 'Ambafen 400 mg/100 ml infusion', codes: ['0509234141'], match: /ambafen/i, kind: 'replace',
    problem: 'Rejected as Out of price list (Tawuniya 07-2026).',
    action: 'Use the contracted IV ibuprofen item code.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'vominore', name: 'Vominore 25 mg tablet', codes: ['0907245515'], match: /vominore/i, kind: 'replace',
    problem: 'Rejected as Out of price list (Tawuniya 07-2026).',
    action: 'Use the contracted dimenhydrinate/antiemetic item code.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'arcoxia', name: 'Arcoxia 90 mg tablet', codes: [], match: /arcoxia\s*90|arcoxia.*90\s*mg/i, kind: 'replace',
    problem: 'Rejected as Out of price list (Tawuniya 07-2026).',
    action: 'Use the contracted strength/item code.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
  {
    key: 'premosan', name: 'Premosan 10 mg/ml injection', codes: [], match: /premosan/i, kind: 'replace',
    problem: 'Rejected as Incorrect billing regime (Tawuniya 07-2026).',
    action: 'Bill it under the medication benefit with its SFDA code, not as a procedure/consumable.',
    source: 'Hospital list · WAD Tawuniya statement 07-2026',
  },
];

/** Adds items that the loaded statements rejected at least twice (same item, same kind of reason). */
export function buildWatchlist(rejections: Rejection[]): WatchItem[] {
  const list = [...HOSPITAL_WATCHLIST];
  const groups = new Map<string, Rejection[]>();
  for (const r of rejections) {
    const k = itemKey(r.serviceDesc);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rs] of groups) {
    if (rs.length < 2) continue;
    const top = Object.entries(rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.cause]: (m[r.cause] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
    const existing = list.find((w) => w.key === k || w.match.test(rs[0].serviceDesc) || rs.some((r) => w.codes.includes(r.serviceCode)));
    if (existing) { existing.times = Math.max(existing.times ?? 0, rs.length); continue; }
    if (top[1] < 2) continue;
    const priceList = /price list|contract/i.test(top[0]);
    list.push({
      key: k, name: rs[0].serviceDesc, codes: [...new Set(rs.map((r) => r.serviceCode).filter(Boolean))], match: new RegExp(`^\\W*${k.split(' ')[0]}`, 'i'), kind: priceList ? 'replace' : 'warning',
      problem: `Rejected ${rs.length}× in loaded statements – ${top[0]} (${top[1]}×).`,
      action: priceList ? 'Bill the contracted item code for this product or ask the insurer to add it to the price list.' : 'Check documentation and coding for this item before submission (see Rejection analytics).',
      source: 'Learned from loaded statements', times: rs.length,
    });
  }
  return list;
}

export function matchWatch(list: WatchItem[], code: string, desc: string): WatchItem | undefined {
  const c = (code || '').trim();
  return list.find((w) => (c && w.codes.includes(c)) || w.match.test(desc) || (w.source.startsWith('Learned') && itemKey(desc) === w.key));
}
