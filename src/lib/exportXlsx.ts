import * as XLSX from 'xlsx';
import type { ClaimAudit, Rejection } from './types';
import type { ImportBundle } from '../db';
import { ruleType } from './kb/rules';

function sheet(rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0] ?? {});
  ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length))) }));
  return ws;
}
const safeSheet = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
function addSheet(wb: XLSX.WorkBook, rows: Record<string, unknown>[], name: string, used: Set<string>) {
  let n = safeSheet(name);
  for (let i = 2; used.has(n); i++) n = `${safeSheet(name).slice(0, 27)} (${i})`;
  used.add(n);
  XLSX.utils.book_append_sheet(wb, sheet(rows.length ? rows : [{ Note: 'No rows' }]), n);
}

/** One row per finding with its source file and row numbers, plus one sheet per doctor. */
export function exportFindings(audits: ClaimAudit[], _bundles: ImportBundle[], file = 'WAD_medical_audit.xlsx') {
  const rows = audits.flatMap((a) => a.findings.map((f) => {
    const lines = (f.lineIds ?? []).map((id) => a.claim.lines.find((l) => l.id === id)).filter(Boolean);
    return {
      Insurer: a.claim.payer, 'Visit date': a.claim.serviceDate, MRN: a.claim.mrn, Patient: a.claim.patientName, Doctor: a.claim.physician, Specialty: a.claim.specialty,
      'Source file': a.claim.sourceFile, 'Source rows': lines.length ? lines.map((l) => l!.rowNo).join(', ') : a.claim.lines.map((l) => l.rowNo).join(', '),
      Invoices: a.claim.invoices.join(', '), ICD: a.claim.diagnoses.map((d) => d.code).join(', '), Services: lines.map((l) => l!.desc).join(' | '),
      Severity: f.severity.toUpperCase(), 'Finding type': f.kind, Area: f.area, Rule: f.ruleId, 'Rule type': ruleType(f.ruleId), Scope: f.scope,
      Finding: f.title, Reason: f.detail, Evidence: f.evidence ?? '', 'Suggested action (review manually)': f.fix, 'SAR at risk (this finding)': f.amountAtRisk, 'Reviewer note': '',
    };
  }));
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  addSheet(wb, rows, 'All findings', used);
  const byDoc = new Map<string, typeof rows>();
  for (const r of rows) byDoc.set(r.Doctor, [...(byDoc.get(r.Doctor) ?? []), r]);
  for (const [doc, rs] of byDoc) addSheet(wb, rs, doc, used);
  XLSX.writeFile(wb, file);
}

export function exportRejections(rs: Rejection[], advice: (r: Rejection) => string[], file = 'WAD_rejection_analysis.xlsx') {
  const rows = rs.map((r) => ({
    Insurer: r.payer, Period: r.period, 'Source file': r.source, 'Source row': r.rowNo, Batch: r.batch, 'Claim ref': r.claimRef, Invoice: r.invoice,
    'Service code': r.serviceCode, Service: r.serviceDesc, Category: r.category, 'Rejected net': r.amount, 'Rejected VAT (line-level)': r.vat ?? '', 'Price excess (separate)': r.priceExcess || '',
    'Original insurer reason': r.reasonRaw, 'Reason code': r.reasonCode, 'NPHIES code': r.nphiesCode, Type: r.group, Subcategory: r.subcategory, Cause: r.cause,
    'Classified from': r.overridden ? 'manual correction' : r.confidence, Link: r.link, Doctor: r.doctor, Specialty: r.specialty, ICD: r.icd, 'Appeal status': r.appealStatus,
    'Suggestion (review manually)': advice(r).join(' '),
  }));
  const wb = XLSX.utils.book_new();
  addSheet(wb, rows, 'Rejections', new Set());
  XLSX.writeFile(wb, file);
}

/** Hands each claims file back with REVIEW markers on the rows of flagged encounters (original columns kept). */
export function exportMarked(flagged: ClaimAudit[], bundles: ImportBundle[], reviewed: (id: string) => boolean, file = 'WAD_marked_claim_files.xlsx') {
  const byLine = new Map<string, ClaimAudit>();
  for (const a of flagged) for (const l of a.claim.lines) byLine.set(l.id, a);
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const list = flagged.map((a) => ({
    Status: reviewed(a.claim.id) ? '✓ REVIEWED' : '⚑ REVIEW', Insurer: a.claim.payer, MRN: a.claim.mrn, Patient: a.claim.patientName, 'Visit date': a.claim.serviceDate, Doctor: a.claim.physician,
    'Source file': a.claim.sourceFile, Rows: a.claim.lines.map((l) => l.rowNo).join(', '), Severity: (a.worst ?? '').toUpperCase(), 'SAR at risk': a.amountAtRisk,
    Reasons: a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').map((f) => f.title).join(' | '),
  }));
  addSheet(wb, list, 'Review list', used);
  const ids = new Set(flagged.map((a) => a.claim.importId));
  for (const b of bundles.filter((x) => ids.has(x.meta.id))) {
    const rows = b.rows.map((r) => {
      const a = byLine.get(`${b.meta.id}#${r.rowNo}`);
      const why = a ? a.findings.filter((f) => f.severity === 'critical' || f.severity === 'high') : [];
      const out: Record<string, unknown> = {
        REVIEW: a ? (reviewed(a.claim.id) ? '✓ REVIEWED' : '⚑ REVIEW') : '', 'Source row': r.rowNo, MRN: a?.claim.mrn ?? '', 'Patient name': a?.claim.patientName ?? '',
        Severity: a ? (a.worst ?? '').toUpperCase() : '', 'Review reasons': why.map((f) => f.title).join(' | '),
      };
      for (const h of b.meta.header) if (h) out[h] = r.values[h] ?? '';
      return out;
    });
    addSheet(wb, rows, b.meta.filename.replace(/\.[a-z]+$/i, ''), used);
  }
  XLSX.writeFile(wb, file);
}
