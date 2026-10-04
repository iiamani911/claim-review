import * as XLSX from 'xlsx';
import type { ClaimAudit, Rejection } from './types';

/** Findings workbook: one sheet for all findings + one sheet per doctor (ready to send for correction). */
export function exportFindings(audits: ClaimAudit[], file = 'WAD_medical_audit.xlsx') {
  const rows = audits.flatMap((a) =>
    a.findings.map((f) => ({
      'Claim No': a.claim.claimNo,
      'Service date': a.claim.serviceDate,
      MRN: a.claim.mrn,
      Patient: a.claim.patientName,
      'Age/Sex': `${a.claim.ageText} ${a.claim.gender}`,
      Doctor: a.claim.physician,
      Specialty: a.claim.specialty,
      ICD: a.claim.diagnoses.map((d) => d.code).join(', '),
      Severity: f.severity.toUpperCase(),
      Area: f.area,
      Rule: f.ruleId,
      Finding: f.title,
      Detail: f.detail,
      'How to fix': f.fix,
      'Suggested note': f.suggestedNote ?? '',
      Services: (f.lineIds ?? []).map((id) => a.claim.lines.find((l) => l.id === id)?.desc).filter(Boolean).join(' | '),
      'SAR at risk': f.amountAtRisk,
      'Doctor reply / correction': '',
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows), 'All findings');
  const byDoc = new Map<string, typeof rows>();
  for (const r of rows) byDoc.set(r.Doctor, [...(byDoc.get(r.Doctor) ?? []), r]);
  const used = new Set<string>(['All findings']);
  for (const [doc, rs] of byDoc) {
    let name = safeSheet(doc);
    for (let i = 2; used.has(name); i++) name = `${safeSheet(doc).slice(0, 27)} (${i})`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, sheet(rs), name);
  }
  XLSX.writeFile(wb, file);
}

export function exportRejections(rs: Rejection[], advice: (r: Rejection) => string[], file = 'WAD_rejection_analysis.xlsx') {
  const rows = rs.map((r) => ({
    Payer: r.payer, Batch: r.batch, 'Claim ref': r.claimRef, Invoice: r.invoice, Date: r.serviceDate, Doctor: r.doctor, Specialty: r.specialty,
    ICD: r.icd, Category: r.category, 'Service code': r.serviceCode, Service: r.serviceDesc, 'Rejected SAR': r.amount,
    'Payer reason': r.reasonRaw, Cause: r.cause, Type: r.group, 'NPHIES code': r.nphiesCode, 'Appeal status': r.appealStatus,
    Recommendation: advice(r).join(' '),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows), 'Rejections');
  XLSX.writeFile(wb, file);
}

function sheet(rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0] ?? {});
  ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length))) }));
  return ws;
}

const safeSheet = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Doctor';
