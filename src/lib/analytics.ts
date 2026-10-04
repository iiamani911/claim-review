import type { AuditArea, ClaimAudit, Rejection, Severity } from './types';
import { AREAS } from './engine';
import { CAUSES, OTHER_CAUSE, causeById } from './kb/rejectionCodes';
import { SERVICE_RULES } from './kb/services';
import { RULES, ruleName } from './kb/rules';
import type { Formulary } from './formulary';
import { inferCategory } from './rejections';

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AuditSummary {
  encounters: number;
  clean: number;
  cleanRate: number;
  amountAtRisk: number;
  billed: number;
  bySeverity: Record<Severity, number>;
  byArea: { area: AuditArea; count: number; critical: number; high: number; encounters: number }[];
  byRule: { ruleId: string; name: string; count: number; amount: number; area: AuditArea; severity: Severity }[];
}

export function summarizeAudits(audits: ClaimAudit[]): AuditSummary {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const area = new Map<AuditArea, { count: number; critical: number; high: number; enc: Set<string> }>();
  const rule = new Map<string, { count: number; amount: number; area: AuditArea; severity: Severity }>();
  let clean = 0;
  for (const a of audits) {
    if (!a.findings.some((f) => f.severity === 'critical' || f.severity === 'high')) clean++;
    for (const f of a.findings) {
      bySeverity[f.severity]++;
      const x = area.get(f.area) ?? { count: 0, critical: 0, high: 0, enc: new Set() };
      x.count++;
      if (f.severity === 'critical') x.critical++;
      if (f.severity === 'high') x.high++;
      x.enc.add(a.claim.id);
      area.set(f.area, x);
      const r = rule.get(f.ruleId) ?? { count: 0, amount: 0, area: f.area, severity: f.severity };
      r.count++;
      r.amount += f.amountAtRisk;
      if (sevRank(f.severity) < sevRank(r.severity)) r.severity = f.severity;
      rule.set(f.ruleId, r);
    }
  }
  return {
    encounters: audits.length,
    clean,
    cleanRate: audits.length ? clean / audits.length : 0,
    amountAtRisk: round2(sum(audits.map((a) => a.amountAtRisk))),
    billed: round2(sum(audits.flatMap((a) => a.claim.lines.map((l) => (l.net > 0 ? l.net : l.billed))))),
    bySeverity,
    byArea: AREAS.map((ar) => ({ area: ar, count: area.get(ar)?.count ?? 0, critical: area.get(ar)?.critical ?? 0, high: area.get(ar)?.high ?? 0, encounters: area.get(ar)?.enc.size ?? 0 })),
    byRule: [...rule.entries()].map(([ruleId, r]) => ({ ruleId, name: ruleName(ruleId), ...r, amount: round2(r.amount) })).sort((a, b) => b.count - a.count),
  };
}

export const sevRank = (s: Severity) => ['critical', 'high', 'medium', 'low'].indexOf(s);

export interface DoctorRow {
  doctor: string;
  specialty: string;
  encounters: number;
  findings: number;
  critical: number;
  high: number;
  amountAtRisk: number;
  billed: number;
  cleanRate: number;
  rejectedAmount: number;
  rejectedLines: number;
  medicalRejected: number;
  topRules: { ruleId: string; name: string; count: number }[];
  byArea: Record<string, number>;
}

export function doctorRows(audits: ClaimAudit[], rejections: Rejection[]): DoctorRow[] {
  const m = new Map<string, DoctorRow & { _rules: Map<string, number> }>();
  const get = (doctor: string, specialty: string) => {
    let r = m.get(doctor);
    if (!r) {
      r = { doctor, specialty, encounters: 0, findings: 0, critical: 0, high: 0, amountAtRisk: 0, billed: 0, cleanRate: 0, rejectedAmount: 0, rejectedLines: 0, medicalRejected: 0, topRules: [], byArea: {}, _rules: new Map() };
      m.set(doctor, r);
    }
    if (!r.specialty && specialty) r.specialty = specialty;
    return r;
  };
  for (const a of audits) {
    const r = get(a.claim.physician, a.claim.specialty);
    r.encounters++;
    r.findings += a.findings.length;
    r.amountAtRisk += a.amountAtRisk;
    r.billed += sum(a.claim.lines.map((l) => (l.net > 0 ? l.net : l.billed)));
    if (!a.findings.some((f) => f.severity === 'critical' || f.severity === 'high')) r.cleanRate++;
    for (const f of a.findings) {
      if (f.severity === 'critical') r.critical++;
      if (f.severity === 'high') r.high++;
      r.byArea[f.area] = (r.byArea[f.area] ?? 0) + 1;
      r._rules.set(f.ruleId, (r._rules.get(f.ruleId) ?? 0) + 1);
    }
  }
  for (const x of rejections) {
    if (!x.doctor) continue;
    const r = get(x.doctor, x.specialty);
    r.rejectedAmount += x.amount;
    r.rejectedLines++;
    if (x.group === 'Medical') r.medicalRejected += x.amount;
  }
  return [...m.values()]
    .map(({ _rules, ...r }) => ({
      ...r,
      cleanRate: r.encounters ? r.cleanRate / r.encounters : 0,
      amountAtRisk: round2(r.amountAtRisk),
      billed: round2(r.billed),
      rejectedAmount: round2(r.rejectedAmount),
      medicalRejected: round2(r.medicalRejected),
      topRules: [..._rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ruleId, count]) => ({ ruleId, name: ruleName(ruleId), count })),
    }))
    .sort((a, b) => b.amountAtRisk + b.rejectedAmount - (a.amountAtRisk + a.rejectedAmount));
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  amount: number;
  medical: number;
  technical: number;
  causes: Record<string, number>;
}

function bucketize(rs: Rejection[], keyOf: (r: Rejection) => string, labelOf?: (r: Rejection) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rs) {
    const k = keyOf(r) || '—';
    const b = m.get(k) ?? { key: k, label: labelOf ? labelOf(r) : k, count: 0, amount: 0, medical: 0, technical: 0, causes: {} };
    b.count++;
    b.amount += r.amount;
    if (r.group === 'Medical') b.medical += r.amount;
    else b.technical += r.amount;
    b.causes[r.cause] = (b.causes[r.cause] ?? 0) + 1;
    m.set(k, b);
  }
  return [...m.values()].map((b) => ({ ...b, amount: round2(b.amount), medical: round2(b.medical), technical: round2(b.technical) })).sort((a, b) => b.amount - a.amount || b.count - a.count);
}

export const normService = (r: Rejection) => r.serviceDesc.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 %/.]/g, '').trim().slice(0, 60);

export function summarizeRejections(rs: Rejection[]) {
  const amount = round2(sum(rs.map((r) => r.amount)));
  const medical = round2(sum(rs.filter((r) => r.group === 'Medical').map((r) => r.amount)));
  return {
    lines: rs.length,
    amount,
    medical,
    technical: round2(amount - medical),
    disagreed: rs.filter((r) => r.appealStatus === 'DISAGREED').length,
    agreed: rs.filter((r) => r.appealStatus === 'AGREED').length,
    linked: rs.filter((r) => r.linkedClaim).length,
    byCause: bucketize(rs, (r) => r.causeId, (r) => r.cause),
    byCategory: bucketize(rs, (r) => r.category || inferCategory(r.serviceDesc, r.serviceCode)),
    byService: bucketize(rs, normService, (r) => r.serviceDesc),
    byDoctor: bucketize(rs, (r) => r.doctor || 'Not linked to an HIS export'),
    byPayer: bucketize(rs, (r) => r.payer),
    byMonth: bucketize(rs, (r) => (r.serviceDate || '').slice(0, 7) || 'Unknown'),
  };
}

/** Service-specific recommendation for one rejected line. */
export function adviseRejection(r: Rejection, formulary: Formulary | null): string[] {
  const cause = causeById(r.causeId);
  const out: string[] = [];
  if ((r.causeId === 'MN-DRUG-DX' || r.causeId === 'MN-AGE' || r.causeId === 'MN-QTY') && formulary) {
    const m = formulary.lookup(r.serviceCode, '', r.serviceDesc);
    if (m && m.ingredient.i.length) {
      const named = r.icdsNamed.length ? r.icdsNamed.join(', ') : r.icd;
      out.push(`${m.scientific}: CHI DDF approved indications – ${m.ingredient.i.slice(0, 6).map((x) => `${x[1]} (${x[0].split(',').slice(0, 3).join(', ')})`).join('; ')}.`);
      if (named) out.push(`Claim was coded ${named}. Code the indication you treated or choose a drug indicated for ${named}.`);
    }
  }
  if (r.causeId === 'MN-JUSTIFY' || r.causeId === 'OTHER') {
    const rule = SERVICE_RULES.find((x) => x.match.test(r.serviceDesc));
    if (rule) out.push(`${rule.label}: ${rule.suggest}`, rule.why);
  }
  if (!out.length) out.push(cause.prevent[0]);
  return out;
}

export interface Action {
  title: string;
  impact: number;
  count: number;
  detail: string;
  kind: 'rejection' | 'audit';
}

/** Ranked prevention plan combining historical rejections (SAR lost) and pre-submission audit (SAR at risk). */
export function actionPlan(audits: ClaimAudit[], rs: Rejection[]): Action[] {
  const acts: Action[] = [];
  for (const b of summarizeRejections(rs).byCause) {
    const c = CAUSES.find((x) => x.id === b.key) ?? OTHER_CAUSE;
    acts.push({ kind: 'rejection', title: c.label, impact: b.amount, count: b.count, detail: c.prevent[0] });
  }
  const s = summarizeAudits(audits);
  for (const r of s.byRule.filter((x) => x.severity === 'critical' || x.severity === 'high').slice(0, 8)) {
    const meta = RULES.find((x) => x.id === r.ruleId);
    acts.push({ kind: 'audit', title: r.name, impact: r.amount, count: r.count, detail: meta?.what ?? '' });
  }
  return acts.sort((a, b) => b.impact - a.impact).slice(0, 8);
}
