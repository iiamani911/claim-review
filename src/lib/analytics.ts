import type { AuditArea, Claim, ClaimAudit, Payer, PayerView, Rejection, Severity } from './types';
import { AREAS } from './engine';
import { causeById } from './rejections';
import { SERVICE_RULES } from './kb/services';
import { ruleName } from './kb/rules';
import type { Formulary } from './formulary';

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const inView = (payer: Payer, view: PayerView) => view === 'Both' || payer === view;
export const sevRank = (s: Severity) => ['critical', 'high', 'medium', 'low'].indexOf(s);
const lineNet = (l: { net: number; billed: number }) => (l.net > 0 ? l.net : l.billed);

export interface AuditSummary {
  encounters: number;
  lines: number;
  clean: number;
  flagged: number;
  amountAtRisk: number;
  submittedNet: number;
  bySeverity: Record<Severity, number>;
  byArea: { area: AuditArea; count: number; critical: number; high: number; encounters: number }[];
  byRule: { ruleId: string; name: string; count: number; area: AuditArea; severity: Severity }[];
}

export const isFlagged = (a: ClaimAudit) => a.findings.some((f) => f.severity === 'critical' || f.severity === 'high');

export function summarizeAudits(audits: ClaimAudit[]): AuditSummary {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const area = new Map<AuditArea, { count: number; critical: number; high: number; enc: Set<string> }>();
  const rule = new Map<string, { count: number; area: AuditArea; severity: Severity }>();
  let clean = 0;
  for (const a of audits) {
    if (!isFlagged(a)) clean++;
    for (const f of a.findings) {
      bySeverity[f.severity]++;
      const x = area.get(f.area) ?? { count: 0, critical: 0, high: 0, enc: new Set() };
      x.count++;
      if (f.severity === 'critical') x.critical++;
      if (f.severity === 'high') x.high++;
      x.enc.add(a.claim.id);
      area.set(f.area, x);
      const r = rule.get(f.ruleId) ?? { count: 0, area: f.area, severity: f.severity };
      r.count++;
      if (sevRank(f.severity) < sevRank(r.severity)) r.severity = f.severity;
      rule.set(f.ruleId, r);
    }
  }
  return {
    encounters: audits.length,
    lines: sum(audits.map((a) => a.claim.lines.length)),
    clean,
    flagged: audits.length - clean,
    // Each line is counted once per encounter in ClaimAudit.amountAtRisk; encounters do not share lines.
    amountAtRisk: round2(sum(audits.map((a) => a.amountAtRisk))),
    submittedNet: round2(sum(audits.flatMap((a) => a.claim.lines.map(lineNet)))),
    bySeverity,
    byArea: AREAS.map((ar) => ({ area: ar, count: area.get(ar)?.count ?? 0, critical: area.get(ar)?.critical ?? 0, high: area.get(ar)?.high ?? 0, encounters: area.get(ar)?.enc.size ?? 0 })),
    byRule: [...rule.entries()].map(([ruleId, r]) => ({ ruleId, name: ruleName(ruleId), ...r })).sort((a, b) => b.count - a.count),
  };
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  amount: number;
  medical: number;
  technical: number;
  review: number;
  causes: Record<string, number>;
  extra?: string;
}

export function bucketize(rs: Rejection[], keyOf: (r: Rejection) => string, labelOf?: (r: Rejection) => string, extraOf?: (r: Rejection) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rs) {
    const k = keyOf(r) || '—';
    const b = m.get(k) ?? { key: k, label: labelOf ? labelOf(r) : k, count: 0, amount: 0, medical: 0, technical: 0, review: 0, causes: {}, extra: extraOf?.(r) };
    b.count++;
    b.amount += r.amount;
    if (r.group === 'Medical') b.medical += r.amount;
    else if (r.group === 'Technical/Administrative') b.technical += r.amount;
    else b.review += r.amount;
    b.causes[r.cause] = (b.causes[r.cause] ?? 0) + 1;
    m.set(k, b);
  }
  return [...m.values()].map((b) => ({ ...b, amount: round2(b.amount), medical: round2(b.medical), technical: round2(b.technical), review: round2(b.review) }));
}

export const byAmount = (a: Bucket, b: Bucket) => b.amount - a.amount || b.count - a.count;
export const byCount = (a: Bucket, b: Bucket) => b.count - a.count || b.amount - a.amount;

export const normService = (r: Rejection) => `${r.serviceCode}|${r.serviceDesc.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)}`;

export interface RejSummary {
  lines: number;
  amount: number;
  vat: number;
  vatLines: number; // lines that carried line-level VAT
  medical: number;
  technical: number;
  review: number;
  priceExcess: number;
  linked: number;
  disagreed: number;
  agreed: number;
}

export function summarizeRejections(rs: Rejection[]): RejSummary {
  const withVat = rs.filter((r) => r.vat !== null);
  return {
    lines: rs.length,
    amount: round2(sum(rs.map((r) => r.amount))),
    vat: round2(sum(withVat.map((r) => r.vat ?? 0))),
    vatLines: withVat.length,
    medical: round2(sum(rs.filter((r) => r.group === 'Medical').map((r) => r.amount))),
    technical: round2(sum(rs.filter((r) => r.group === 'Technical/Administrative').map((r) => r.amount))),
    review: round2(sum(rs.filter((r) => r.group === 'Needs review').map((r) => r.amount))),
    priceExcess: round2(sum(rs.map((r) => r.priceExcess))),
    linked: rs.filter((r) => r.link === 'linked' || r.link === 'probable').length,
    disagreed: rs.filter((r) => r.appealStatus === 'DISAGREED').length,
    agreed: rs.filter((r) => r.appealStatus === 'AGREED').length,
  };
}

/** Submitted claim volume for a payer and month – the only valid denominator for rejection rates. */
export interface Denominator { lines: number; net: number; encounters: number }

export function denominators(claims: Claim[]): Map<string, Denominator> {
  const m = new Map<string, Denominator>();
  for (const c of claims) {
    const k = `${c.payer}|${c.period}`;
    const d = m.get(k) ?? { lines: 0, net: 0, encounters: 0 };
    d.lines += c.lines.length;
    d.net += sum(c.lines.map(lineNet));
    d.encounters++;
    m.set(k, d);
  }
  return m;
}

export interface DoctorRow {
  doctor: string;
  specialty: string;
  encounters: number;
  lines: number;
  submittedNet: number;
  findings: number;
  flagged: number;
  amountAtRisk: number;
  rejectedAmount: number;
  rejectedLines: number;
  medicalRejected: number;
  topReasons: [string, number][];
  topRules: { ruleId: string; name: string; count: number }[];
}

export function doctorRows(audits: ClaimAudit[], rejections: Rejection[]): DoctorRow[] {
  const m = new Map<string, DoctorRow & { _rules: Map<string, number>; _reasons: Map<string, number> }>();
  const get = (doctor: string, specialty: string) => {
    let r = m.get(doctor);
    if (!r) {
      r = { doctor, specialty, encounters: 0, lines: 0, submittedNet: 0, findings: 0, flagged: 0, amountAtRisk: 0, rejectedAmount: 0, rejectedLines: 0, medicalRejected: 0, topReasons: [], topRules: [], _rules: new Map(), _reasons: new Map() };
      m.set(doctor, r);
    }
    if ((!r.specialty || r.specialty === 'Unspecified') && specialty) r.specialty = specialty;
    return r;
  };
  for (const a of audits) {
    const r = get(a.claim.physician, a.claim.specialty);
    r.encounters++;
    r.lines += a.claim.lines.length;
    r.submittedNet += sum(a.claim.lines.map(lineNet));
    r.findings += a.findings.length;
    r.amountAtRisk += a.amountAtRisk;
    if (isFlagged(a)) r.flagged++;
    for (const f of a.findings) r._rules.set(f.ruleId, (r._rules.get(f.ruleId) ?? 0) + 1);
  }
  for (const x of rejections) {
    const r = get(x.doctor || 'Not linked to a claim', x.specialty);
    r.rejectedAmount += x.amount;
    r.rejectedLines++;
    if (x.group === 'Medical') r.medicalRejected += x.amount;
    r._reasons.set(x.cause, (r._reasons.get(x.cause) ?? 0) + 1);
  }
  return [...m.values()]
    .map(({ _rules, _reasons, ...r }) => ({
      ...r,
      amountAtRisk: round2(r.amountAtRisk),
      submittedNet: round2(r.submittedNet),
      rejectedAmount: round2(r.rejectedAmount),
      medicalRejected: round2(r.medicalRejected),
      topReasons: [..._reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topRules: [..._rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ruleId, count]) => ({ ruleId, name: ruleName(ruleId), count })),
    }))
    .sort((a, b) => b.rejectedAmount - a.rejectedAmount || b.amountAtRisk - a.amountAtRisk);
}

/** Service-specific suggestion for one rejected line (to be reviewed manually). */
export function adviseRejection(r: Rejection, formulary: Formulary | null): string[] {
  const cause = causeById(r.causeId);
  const out: string[] = [];
  if ((r.causeId === 'MN-DRUG-DX' || r.causeId === 'MN-AGE' || r.causeId === 'MN-QTY') && formulary) {
    const m = formulary.lookup(r.serviceCode, '', r.serviceDesc);
    if (m && m.ingredient.i.length) {
      out.push(`${m.scientific} (${m.matchedBy}): CHI DDF indications include ${m.ingredient.i.slice(0, 5).map((x) => `${x[1]} (${x[0].split(',').slice(0, 3).join(', ')})`).join('; ')}.`);
      const named = r.icdsNamed.length ? r.icdsNamed.join(', ') : r.icd;
      if (named) out.push(`Claim was coded ${named}.`);
    } else out.push('Drug could not be resolved in the formulary – compatibility not assessed.');
  }
  if (r.causeId === 'MN-JUSTIFY' || r.causeId === 'NEEDS-REVIEW') {
    const rule = SERVICE_RULES.find((x) => x.match.test(r.serviceDesc));
    if (rule) out.push(`${rule.label}: ${rule.suggest}`);
  }
  if (!out.length) out.push(cause.prevent[0]);
  return out;
}
