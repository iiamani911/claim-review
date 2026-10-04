import type { Claim, Rejection } from './types';
import type { DetectedTable } from './parse';
import { money, parseDate, pick } from './parse';
import { classify } from './kb/rejectionCodes';

const invKey = (s: string) => (s || '').replace(/\D/g, '').slice(-10);

export function inferCategory(desc: string, code = ''): string {
  const d = desc.toLowerCase();
  if (/consult|assessment|office visit|follow.?up visit/.test(d)) return 'Dr. Consultations';
  if (/x-?ray|radiograph|u\/s|ultra ?sound|sonar|\bmri\b|\bct\b|scan|mammo|doppler/.test(d)) return 'Radiology';
  if (/tablet|capsule|injection|\binj\b|syrup|suspension|cream|ointment|gel|spray|drops?|sachet|ampoule|vial|bottle|\bmg\b|\bml\b|patch|tape|solution|powder|suppositor|inhaler|lozenge/.test(d) || /^\d{10}$|^\d{1,3}-\d{2,4}-\d{2}$/.test(code.trim())) return 'Medicine';
  if (/count|test|analysis|typing|glucose|culture|hba1c|serum|blood|urine|stool|level|antigen|antibod|profile|tsh|vitamin|crp|esr|ferritin|creatinin|urea|bilirubin|enzyme|pcr|swab|smear/.test(d)) return 'Laboratory';
  if (/dressing|suture|injection admin|i\.?v|infusion|nebul|extraction|restoration|wash|procedure|ecg|excision|incision|drainage/.test(d)) return 'Procedures';
  return 'Other';
}

export function parseRejections(t: DetectedTable, source: string): Rejection[] {
  const out: Rejection[] = [];
  t.records.forEach((r, i) => {
    let rej: Omit<Rejection, 'causeId' | 'cause' | 'group' | 'category' | 'doctor' | 'specialty' | 'icd' | 'serviceDate' | 'icdsNamed'> & { icd?: string; doctor?: string; serviceDate?: string };
    if (t.kind === 'rejections-waseel') {
      rej = {
        id: `${source}-${i}`, payer: 'Tawuniya', source, batch: pick(r, 'Waseel Batch'),
        claimRef: pick(r, 'Claim No.'), invoice: pick(r, 'Invoice Number', 'Provider Ref'),
        serviceCode: pick(r, 'Service Code'), serviceDesc: pick(r, 'Service'),
        amount: money(pick(r, 'Rejected Amount')) + money(pick(r, 'Exceed Price')),
        reasonRaw: pick(r, 'Reason', 'Nphies Rejection Description', 'Tawuniya Reply', 'Payer Comment'),
        nphiesCode: pick(r, 'Nphies Rejection Code'),
        appealStatus: pick(r, 'Status').toUpperCase(), appealText: pick(r, 'Comments'),
        doctor: pick(r, 'Doctor Code') ? `Dr code ${pick(r, 'Doctor Code')}` : '',
      };
    } else if (t.kind === 'rejections-bupa') {
      rej = {
        id: `${source}-${i}`, payer: 'Bupa Arabia', source, batch: pick(r, 'BATCH_ID'),
        claimRef: pick(r, 'CLAIM_ID'), invoice: pick(r, 'INV_NO'),
        serviceCode: pick(r, 'SERV_CODE'), serviceDesc: pick(r, 'SERV_DESC') || pick(r, 'REJ_DESC'),
        amount: money(pick(r, 'Reject_Amount')),
        reasonRaw: [pick(r, 'REJ_DESC'), pick(r, 'nphies denial description')].filter(Boolean).join(' — '),
        nphiesCode: pick(r, 'nphies rejection code'),
        appealStatus: '', appealText: '',
        icd: pick(r, 'ICD Code'), serviceDate: parseDate(pick(r, 'INCUR_DATE_FROM', 'INV_DATE')),
      };
      if (!rej.claimRef && !rej.serviceDesc) {
        // Batch-level adjustment row (e.g. deductible difference).
        const lbl = Object.values(r).find((v) => /[a-z]/i.test(v)) ?? 'Batch adjustment';
        rej.serviceDesc = lbl;
        rej.reasonRaw = Object.values(r).filter((v) => /[a-z]/i.test(v)).join(' — ');
        rej.amount = money(Object.values(r).filter((v) => /^\d+(\.\d+)?$/.test(v)).slice(-2, -1)[0] ?? '0');
      }
    } else {
      rej = {
        id: `${source}-${i}`, payer: pick(r, 'Payer', 'Insurance', 'Company') || 'Unknown payer', source, batch: pick(r, 'Batch', 'Batch ID'),
        claimRef: pick(r, 'Claim No', 'Claim ID', 'Claim'), invoice: pick(r, 'Invoice', 'Invoice No', 'Invoice Number'),
        serviceCode: pick(r, 'Service Code', 'Code'), serviceDesc: pick(r, 'Service Description', 'Service', 'Description'),
        amount: money(pick(r, 'Rejected Amount', 'Reject Amount', 'Rejection Amount', 'Amount')),
        reasonRaw: pick(r, 'Reason', 'Rejection Reason', 'Rejection Description', 'Remarks'),
        nphiesCode: pick(r, 'Nphies Code', 'Rejection Code', 'Code'),
        appealStatus: pick(r, 'Status').toUpperCase(), appealText: pick(r, 'Comments', 'Appeal'),
        icd: pick(r, 'ICD', 'Diagnosis'),
      };
    }
    if (rej.amount <= 0 && !rej.reasonRaw) return; // informational line without rejection
    if (!rej.reasonRaw && rej.amount <= 0) return;
    const cause = classify(rej.reasonRaw, rej.nphiesCode);
    const icdsNamed = [...new Set([...(rej.reasonRaw.match(/diagnosis code\s+([A-Z]\d{2}(?:\.\d{1,3})?)/gi) ?? [])].map((m) => m.split(/\s+/).pop()!.toUpperCase()))];
    out.push({
      ...rej,
      reasonRaw: rej.reasonRaw || '(no reason given)',
      causeId: cause.id, cause: cause.label, group: cause.group,
      category: inferCategory(rej.serviceDesc, rej.serviceCode),
      icd: rej.icd ?? '', doctor: rej.doctor ?? '', specialty: '', serviceDate: rej.serviceDate ?? '',
      icdsNamed,
    });
  });
  return out;
}

/** Link rejections to audited claims via invoice number → doctor, specialty, ICD, category, date. */
export function linkRejections(rejections: Rejection[], claims: Claim[]): Rejection[] {
  const byInv = new Map<string, Claim>();
  // Rejected-claim exports (rejection section) win over the same invoice in other sections.
  const ordered = [...claims.filter((c) => c.section !== 'rejection'), ...claims.filter((c) => c.section === 'rejection')];
  for (const c of ordered) for (const l of c.lines) if (l.invoice) byInv.set(invKey(l.invoice), c);
  const codeToName = new Map<string, string>();
  const linked = rejections.map((r) => {
    const c = byInv.get(invKey(r.invoice));
    if (!c) return r;
    const line = c.lines.find((l) => invKey(l.invoice) === invKey(r.invoice) && (l.code === r.serviceCode || similar(l.desc, r.serviceDesc)))
      ?? c.lines.find((l) => invKey(l.invoice) === invKey(r.invoice) && inferCategory(l.desc, l.code) === r.category);
    if (r.doctor.startsWith('Dr code')) codeToName.set(r.doctor, c.physician);
    return {
      ...r,
      doctor: c.physician,
      specialty: c.specialty,
      icd: r.icd || c.diagnoses.map((d) => d.code).join(', '),
      category: line?.category ?? r.category,
      serviceDate: r.serviceDate || c.serviceDate,
      claimRef: r.claimRef,
      linkedClaim: c.id,
    } as Rejection & { linkedClaim: string };
  });
  return linked.map((r) => (r.doctor.startsWith('Dr code') && codeToName.has(r.doctor) ? { ...r, doctor: codeToName.get(r.doctor)! } : r));
}

function similar(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wb = b.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return wb.filter((w) => wa.has(w)).length >= Math.min(2, wb.length);
}
