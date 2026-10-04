/**
 * Historical pattern analysis: counts of rejected vs submitted lines from imported records.
 * This is descriptive statistics over the hospital's own imports – not a trained model and not an insurer rule.
 */
import type { Claim, Finding, Payer, Rejection } from './types';

export interface Pattern {
  key: string; // payer|service|dx
  payer: Payer;
  serviceKey: string;
  serviceLabel: string;
  dxGroup: string; // '' = any diagnosis
  submitted: number;
  rejected: number;
  rejectedAmount: number;
  periods: string[];
  reasons: Record<string, number>;
}

export interface AcceptedRule { id: string; payer: Payer; serviceKey: string; dxGroup: string; serviceLabel: string; rejected: number; submitted: number }

export interface HistoryIndex {
  patterns: Map<string, Pattern>;
  /** Periods per payer that have both claims and rejection data (the comparable window). */
  comparable: Record<Payer, string[]>;
  accepted: AcceptedRule[];
  unlinkedRejections: number;
}

export const serviceKeyOf = (code: string, desc: string) => (code ? `code:${code.replace(/\s+/g, '').toUpperCase()}` : `name:${desc.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)}`);
const dxGroupOf = (c: Claim) => c.diagnoses[0]?.code.slice(0, 3) ?? '';

export function buildHistory(claims: Claim[], rejections: Rejection[], accepted: AcceptedRule[]): HistoryIndex {
  const rejPeriods: Record<Payer, Set<string>> = { Bupa: new Set(), Tawuniya: new Set() };
  for (const r of rejections) if (r.period) rejPeriods[r.payer].add(r.period);
  const claimPeriods: Record<Payer, Set<string>> = { Bupa: new Set(), Tawuniya: new Set() };
  for (const c of claims) if (c.period) claimPeriods[c.payer].add(c.period);
  const comparable = {
    Bupa: [...rejPeriods.Bupa].filter((p) => claimPeriods.Bupa.has(p)).sort(),
    Tawuniya: [...rejPeriods.Tawuniya].filter((p) => claimPeriods.Tawuniya.has(p)).sort(),
  };
  const patterns = new Map<string, Pattern>();
  const lineInfo = new Map<string, { claim: Claim; key: string; label: string }>();
  const bump = (payer: Payer, sk: string, label: string, dx: string, period: string) => {
    for (const d of [dx, '']) {
      const k = `${payer}|${sk}|${d}`;
      const p = patterns.get(k) ?? { key: k, payer, serviceKey: sk, serviceLabel: label, dxGroup: d, submitted: 0, rejected: 0, rejectedAmount: 0, periods: [], reasons: {} };
      p.submitted++;
      if (period && !p.periods.includes(period)) p.periods.push(period);
      patterns.set(k, p);
    }
  };
  for (const c of claims) {
    if (!comparable[c.payer].includes(c.period)) continue;
    const dx = dxGroupOf(c);
    for (const l of c.lines) {
      const sk = serviceKeyOf(l.code, l.desc);
      lineInfo.set(l.id, { claim: c, key: sk, label: l.desc });
      bump(c.payer, sk, l.desc, dx, c.period);
    }
  }
  let unlinked = 0;
  const counted = new Set<string>();
  for (const r of rejections) {
    if (!r.linkedLine || (r.link !== 'linked' && r.link !== 'probable')) { unlinked++; continue; }
    const info = lineInfo.get(r.linkedLine);
    if (!info || counted.has(r.linkedLine)) continue;
    counted.add(r.linkedLine);
    for (const d of [dxGroupOf(info.claim), '']) {
      const p = patterns.get(`${r.payer}|${info.key}|${d}`);
      if (!p) continue;
      p.rejected++;
      p.rejectedAmount += r.amount;
      p.reasons[r.cause] = (p.reasons[r.cause] ?? 0) + 1;
    }
  }
  return { patterns, comparable, accepted, unlinkedRejections: unlinked };
}

export const MIN_SUBMITTED = 5;
export const MIN_REJECTED = 2;
export const MIN_RATE = 0.2;

export function significant(p: Pattern) {
  return p.submitted >= MIN_SUBMITTED && p.rejected >= MIN_REJECTED && p.rejected / p.submitted >= MIN_RATE;
}

const range = (ps: string[]) => (ps.length ? (ps.length > 1 ? `${[...ps].sort()[0]} – ${[...ps].sort().slice(-1)[0]}` : ps[0]) : 'no period');

export function evidenceText(p: Pattern): string {
  const top = Object.entries(p.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} (${v})`).join(', ');
  return `This combination had ${p.rejected} rejected line${p.rejected === 1 ? '' : 's'} out of ${p.submitted} comparable submitted line${p.submitted === 1 ? '' : 's'} for ${p.payer} during ${range(p.periods)}${top ? `. Reasons: ${top}` : ''}.`;
}

type NewFinding = Omit<Finding, 'id' | 'amountAtRisk' | 'kind' | 'scope'> & { amountAtRisk?: number; kind?: Finding['kind']; scope?: Finding['scope'] };

export function historicalFindings(c: Claim, h: HistoryIndex): NewFinding[] {
  const out: NewFinding[] = [];
  const dx = dxGroupOf(c);
  for (const l of c.lines) {
    const sk = serviceKeyOf(l.code, l.desc);
    const rule = h.accepted.find((a) => a.payer === c.payer && a.serviceKey === sk && (!a.dxGroup || a.dxGroup === dx));
    if (rule) {
      out.push({ ruleId: `HIST-R-${rule.id.slice(-6)}`, area: 'Historical rejection pattern', kind: 'historical-pattern', scope: c.payer, severity: 'high', title: `Accepted ${c.payer} pattern rule: ${l.desc}${rule.dxGroup ? ` with ${rule.dxGroup}` : ''}`, detail: `Rule accepted by a reviewer from ${rule.rejected}/${rule.submitted} historical rejected/submitted lines.`, fix: 'Review documentation and coding for this service before submission; this is the hospital’s own rule, not an insurer guarantee.', lineIds: [l.id], refs: ['Hospital rule (accepted historical pattern)'] });
      continue;
    }
    const p = h.patterns.get(`${c.payer}|${sk}|${dx}`);
    const any = h.patterns.get(`${c.payer}|${sk}|`);
    const best = p && significant(p) ? p : any && significant(any) ? any : null;
    if (best) out.push({ ruleId: 'HIST-001', area: 'Historical rejection pattern', kind: 'historical-pattern', scope: c.payer, severity: 'medium', title: `Often rejected by ${c.payer}: ${l.desc}${best.dxGroup ? ` with ${best.dxGroup}` : ''}`, detail: `${evidenceText(best)} Historical frequency is not proof of medical incompatibility or a universal insurer rule.`, evidence: `Sample: ${best.submitted} submitted lines; only rejections linked to an imported claim line are counted (${h.unlinkedRejections} unlinked rejection lines excluded).`, fix: 'Check that the documentation and diagnosis support this service; compare with the reasons above.', lineIds: [l.id], amountAtRisk: 0, refs: ['Historical pattern analysis of imported records'] });
  }
  return out;
}
