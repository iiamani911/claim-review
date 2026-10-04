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

export interface MarkedSource {
  name: string;
  section: string;
  header: string[];
  records: Record<string, string>[];
  idOf: (r: Record<string, string>) => string;
}

/**
 * Hands the uploaded claim files back with review markers: every row of an encounter that needs review gets
 * "⚑ REVIEW", the file number, patient name, worst severity and the reasons, in front of the original columns.
 */
export function exportMarked(sources: MarkedSource[], audits: Map<string, ClaimAudit>, reviewed: (id: string) => boolean, file = 'WAD_marked_files.xlsx') {
  const wb = XLSX.utils.book_new();
  const list: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const used = new Set<string>();
  for (const s of sources) {
    const rows = s.records.map((r) => {
      const id = s.idOf(r);
      const a = audits.get(id);
      const serious = a?.findings.filter((f) => f.severity === 'critical' || f.severity === 'high') ?? [];
      const flag = serious.length ? (reviewed(id) ? '✓ REVIEWED' : '⚑ REVIEW') : '';
      if (a && serious.length && !seen.has(id)) {
        seen.add(id);
        list.push({
          Status: flag, Section: s.section, 'File No': a.claim.mrn, Patient: a.claim.patientName, 'Claim No': a.claim.claimNo, Date: a.claim.serviceDate,
          Doctor: a.claim.physician, Severity: (a.worst ?? '').toUpperCase(), 'SAR at risk': a.amountAtRisk, Reasons: serious.map((f) => f.title).join(' | '), 'Source file': s.name,
        });
      }
      const out: Record<string, unknown> = {
        REVIEW: flag,
        'File No': a?.claim.mrn ?? '',
        'Patient name': a?.claim.patientName ?? '',
        Severity: serious.length ? (a?.worst ?? '').toUpperCase() : '',
        'Review reasons': serious.map((f) => f.title).join(' | '),
      };
      for (const h of s.header) if (h) out[h] = r[h.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? '';
      return out;
    });
    let name = safeSheet(s.name.replace(/\.[a-z]+$/i, ''));
    for (let i = 2; used.has(name) || name === 'Review list'; i++) name = `${safeSheet(s.name).slice(0, 27)} (${i})`;
    used.add(name);
    const ws = sheet(rows);
    ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const lw = sheet(list.length ? list : [{ Status: 'No files need review' }]);
  XLSX.utils.book_append_sheet(wb, lw, 'Review list');
  wb.SheetNames.unshift(wb.SheetNames.pop()!);
  XLSX.writeFile(wb, file);
}
