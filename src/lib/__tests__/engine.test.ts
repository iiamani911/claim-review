import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Formulary } from '../formulary';
import { auditAll } from '../engine';
import { parseAge, parseDate, normalizePayer, readTables, detectTables, CLAIM_FIELDS, autoMap, toRecord, canon, buildClaims, isPlaceholder } from '../parse';
import { classify, parseStatementRow } from '../rejections';
import { mention } from '../text';
import { deriveDataset } from '../../dataset';
import { demoBundles } from '../../demo';
import { analyzeOverlap, commit, refresh, type Staged } from '../../importer';
import { summarizeRejections } from '../analytics';

const formulary = new Formulary(JSON.parse(readFileSync(join(__dirname, '../../../public/data/formulary.json'), 'utf8')));
const KV = { overrides: {}, review: {}, rules: [], verified: {} };

const HIS = [
  'VAT Registration No. = 310390376700003',
  'MRN\tName\tgender\tAge\tClaimNo\tins comp name\tINVOICE\tapproval no\tPhysician Id\tPhysician name\tDrs speciality\tServiceCategory\tservice code\tServiceDescription\tServiceUnits\tBilledAmount\tPatientPayAmount\tDiscount\tNet amount\tNet Vat\tICD1\tdiag desc\tinitial diag\tdiag 2\tdiag 3 code\tService date\tBP\tTemperature\tpulse\tRespiratory Rate\tWeight\tChief complaint\tTooth Number\tGTIN',
  '0012\tA Patient\tMale\t1Y 3M\t-1\tBUPA ARABIA FOR COOPERATIVE INSURANCE\t20262000001\t-1\t77\tDr X\tPediatrics\tDr. Consultations\t CO0011000\tConsultation\t1\t50\t10\t0\t40\t0\tJ06.9\tURTI\t-1\tR50.9\t-1\t05-06-2026\t-1\t36.8\t110\t28\t9.5\tfever and cough since 2 days\t-1\t-1',
  '0012\tA Patient\tMale\t1Y 3M\t-1\tBUPA ARABIA FOR COOPERATIVE INSURANCE\t20262000002\t-1\t77\tDr X\tPediatrics\tMedicine\t3103210658\tPantrox 40 mg\t1\t8\t0\t0\t8\t0\tJ06.9\tURTI\t-1\tR50.9\t-1\t05-06-2026\t-1\t36.8\t110\t28\t9.5\tfever and cough since 2 days\t-1\t06285111001021',
  '0099\tB Patient\tFemale\t35Y\t-1\tBUPA ARABIA FOR COOPERATIVE INSURANCE\t20262000003\t-1\t78\tDr Y\tGP\tLaboratory\tLA0010\tCBC\t1\t36\t0\t0\t36\t0\tJ00\tcold\t-1\t-1\t-1\t06-06-2026\t120/80\t37\t80\t18\t60\tcold\t-1\t-1',
].join('\r\n');

function stageText(name: string, text: string): Staged {
  const { format, tables } = readTables(new TextEncoder().encode(text).buffer as ArrayBuffer, name);
  const d = detectTables(tables)[0];
  return refresh({ key: name, filename: name, sheet: d.sheet, format, layout: d.layout, fileType: d.fileType, header: d.header, headerRow: d.headerRow + 1, mapping: autoMap(d.header, CLAIM_FIELDS), records: d.dataRows.map((r) => ({ rowNo: r.rowNo, values: toRecord(d.header, r.cells) })), detection: { payer: null, basis: '', counts: {}, unknownRows: 0, mixed: false }, payer: null, periods: [], periodOverride: '', version: '' });
}

describe('import: HIS tab-separated .xls with VAT preamble', () => {
  const s = stageText('output(2).xls', HIS);
  it('detects the real format and header row', () => {
    expect(s.format).toBe('tsv');
    expect(s.layout).toBe('his-claims');
    expect(s.headerRow).toBe(2);
    expect(s.records[0].rowNo).toBe(3);
  });
  it('detects the insurer from the insurer column and the period from service dates', () => {
    expect(s.payer).toBe('Bupa');
    expect(s.detection.basis).toMatch(/Insurer column/);
    expect(s.periods).toEqual(['2026-06']);
  });
  it('keeps identifiers and GTINs as text with leading zeros', () => {
    const c = canon(s.records[1].values, s.mapping!);
    expect(c.mrn).toBe('0012');
    expect(c.gtin).toBe('06285111001021');
  });
  it('never merges or drops rows because ClaimNo is -1', () => {
    const claims = buildClaims(s.records.map((r) => ({ rowNo: r.rowNo, c: canon(r.values, s.mapping!), payer: 'Bupa' as const })), 'imp', 'output(2).xls');
    expect(claims).toHaveLength(2); // two patients/dates/doctors
    const a = claims.find((c) => c.mrn === '0012')!;
    expect(a.lines.map((l) => l.rowNo)).toEqual([3, 4]);
    expect(a.invoices).toHaveLength(2);
    expect(a.claimNo).toBe('');
    expect(a.diagnoses.map((d) => d.code)).toEqual(['J06.9', 'R50.9']); // -1 placeholders excluded
    expect(a.ageYears).toBeCloseTo(1.25);
    expect(a.serviceDate).toBe('2026-06-05');
    expect(a.lines[1].gtin).toBe('06285111001021');
  });
  it('detects an exact re-upload and imports nothing new', () => {
    const first = commit(s, { mode: 'new-only' }, []).bundle;
    const again = stageText('output(2).xls', HIS);
    const ov = analyzeOverlap(again, [first]);
    expect(ov.exactDuplicateOf?.id).toBe(first.meta.id);
    expect(commit(again, { mode: 'new-only' }, [first]).bundle.meta.imported).toBe(0);
  });
});

describe('parsing helpers', () => {
  it('ages, dates, placeholders, insurer names', () => {
    expect(parseAge('35Y ')).toBe(35);
    expect(parseAge('6M')).toBeCloseTo(0.5);
    expect(parseDate(' 24-07-2026')).toBe('2026-07-24');
    expect(isPlaceholder('-1')).toBe(true);
    expect(normalizePayer('BUPA ARABIA FOR COOPERATIVE INSURANCE')).toBe('Bupa');
    expect(normalizePayer('tawuniya insurance companies')).toBe('Tawuniya');
    expect(normalizePayer('Medgulf')).toBeNull();
  });
  it('negation-aware text', () => {
    expect(mention('He denied fever, chills, cough.', /fever/i)).toBe('negated');
    expect(mention('non-bloody vomiting with mild fever', /fever/i)).toBe('positive');
  });
});

describe('rejection classification', () => {
  it('distinguishes authorisation reasons and uses insurer codes', () => {
    expect(classify('Already rejected/Cancelled at preauthorization — Preauthorization is required and was not obtained', ['BE-1-4', '142'], 'Bupa').cause.id).toBe('TC-PA-DENIED');
    expect(classify('Preauthorization is required and was not obtained', ['BE-1-4'], 'Bupa').cause.id).toBe('TC-PA-MISSING');
    expect(classify('Medication X is not indicated with diagnosis code J06.9', ['MN-1-1'], 'Bupa').cause.id).toBe('MN-DRUG-DX');
    expect(classify('Out Of Price List', [], 'Tawuniya').cause.id).toBe('TC-PRICE');
    expect(classify('', [], 'Tawuniya').cause.id).toBe('NEEDS-REVIEW');
  });
  it('treats deductible differences as financial adjustments, not rejections', () => {
    const out = parseStatementRow('bupa-clprovstm', { REJ_DESC: 'Deductible difference', Reject_Amount: '129.47', VAT_REJ_AMT: '16.91' }, null, { importId: 'x', rowNo: 9, payer: 'Bupa', source: 'f', period: '2026-06' });
    expect(out && typeof out === 'object' && !('causeId' in out)).toBe(true);
  });
  it('keeps VAT only when the line provides it', () => {
    const w = parseStatementRow('tawuniya-waseel', { 'Rejected Amount': '6', Reason: 'Out Of Price List', 'Invoice Number': '1' }, null, { importId: 'x', rowNo: 2, payer: 'Tawuniya', source: 'f', period: '2026-07' });
    expect(w && typeof w === 'object' && 'vat' in w && w.vat).toBeNull();
  });
});

describe('demo dataset (both insurers)', () => {
  const ds = deriveDataset(demoBundles(), KV);
  const audits = auditAll(ds.claims, formulary);
  it('keeps Bupa and Tawuniya separate and the combined view reconciles', () => {
    const both = summarizeRejections(ds.rejections).amount;
    const b = summarizeRejections(ds.rejections.filter((r) => r.payer === 'Bupa')).amount;
    const t = summarizeRejections(ds.rejections.filter((r) => r.payer === 'Tawuniya')).amount;
    expect(b).toBeGreaterThan(0);
    expect(t).toBeGreaterThan(0);
    expect(both).toBeCloseTo(b + t, 2);
    expect(ds.adjustments).toHaveLength(1); // deductible row excluded from rejections
  });
  it('links rejection lines to claim lines of the same insurer', () => {
    expect(ds.rejections.filter((r) => r.link === 'linked' || r.link === 'probable').length).toBeGreaterThanOrEqual(ds.rejections.length - 1);
    for (const r of ds.rejections) if (r.linkedClaim) expect(ds.claims.find((c) => c.id === r.linkedClaim)!.payer).toBe(r.payer);
  });
  it('audit still catches the core medical issues', () => {
    const all = audits.flatMap((a) => a.findings.map((f) => f.ruleId));
    for (const id of ['DDX-001', 'SVC-002', 'VIT-001', 'DOC-005', 'DOC-006', 'SAF-001', 'SAF-004', 'COD-009', 'VIT-010', 'SVC-008']) expect(all).toContain(id);
  });
  it('counts each billing line once in amount at risk', () => {
    for (const a of audits) expect(a.amountAtRisk).toBeLessThanOrEqual(a.claim.lines.reduce((s, l) => s + (l.net > 0 ? l.net : l.billed), 0) + 0.01);
  });
  it('without a price list, price checks are not run', () => {
    expect(audits.flatMap((a) => a.findings).some((f) => f.ruleId.startsWith('TEC-PRICE'))).toBe(false);
  });
});
