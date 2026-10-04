import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Formulary, icdMatches } from '../formulary';
import { auditAll, auditClaim } from '../engine';
import { HOSPITAL_WATCHLIST, matchWatch } from '../kb/watchlist';
import { buildClaims, parseAge, parseDate, detect, readTables } from '../parse';
import { mention } from '../text';
import { classify } from '../kb/rejectionCodes';
import { parseRejections, linkRejections } from '../rejections';
import { demoClaimRecords, demoRejectionTable } from '../../demo';

const formulary = new Formulary(JSON.parse(readFileSync(join(__dirname, '../../../public/data/formulary.json'), 'utf8')));
const claims = buildClaims(demoClaimRecords(), 'demo');
const audits = auditAll(claims, formulary);
const byClaim = (no: string, date?: string) => audits.find((a) => a.claim.claimNo === no && (!date || a.claim.serviceDate === date))!;
const rules = (no: string, date?: string) => byClaim(no, date).findings.map((f) => f.ruleId);

describe('parsing', () => {
  it('parses ages and dates', () => {
    expect(parseAge('35Y ')).toBe(35);
    expect(parseAge('1Y 3M')).toBeCloseTo(1.25);
    expect(parseAge('7M')).toBeCloseTo(0.58, 1);
    expect(parseDate(' 24-07-2026')).toBe('2026-07-24');
    expect(parseDate('2026-06-11')).toBe('2026-06-11');
  });
  it('reads HIS tab-separated "xls" with a preamble line', () => {
    const txt = 'VAT Registration No. = 1\r\nMRN\tName\tClaimNo\tServiceDescription\tICD1\tservice code\r\n1\tA\t10\tCBC\tJ00\tLA1\r\n';
    const t = detect(readTables('x.xls', new TextEncoder().encode(txt).buffer as ArrayBuffer));
    expect(t[0].kind).toBe('claims');
    expect(buildClaims(t[0].records, 'x')[0].diagnoses[0].code).toBe('J00');
  });
  it('splits one HIS claim number into encounters by patient/date/doctor', () => {
    expect(claims.filter((c) => c.claimNo === 'D-1001')).toHaveLength(2);
  });
});

describe('negation-aware text', () => {
  it('detects denied symptoms', () => {
    expect(mention('He denied fever, chills, cough.', /fever/i)).toBe('negated');
    expect(mention('non-bloody vomiting with mild fever', /fever/i)).toBe('positive');
    expect(mention('no cough but fever since 2 days', /fever/i)).toBe('positive');
  });
});

describe('formulary', () => {
  it('matches ICD prefixes both ways', () => {
    expect(icdMatches('J02.9', 'J02')).toBe(true);
    expect(icdMatches('K21', 'K21.9')).toBe(true);
    expect(icdMatches('R51', 'R52')).toBe(false);
  });
  it('resolves SFDA register numbers to ingredients', () => {
    expect(formulary.lookup('3103210658', '', 'Pantrox')?.scientific).toBe('PANTOPRAZOLE');
  });
});

describe('medical audit rules', () => {
  it('flags drug not indicated (pantoprazole for URTI) as critical', () => {
    const f = byClaim('D-1001', '2026-07-03').findings.find((x) => x.ruleId === 'DDX-001' && x.title.includes('PANTOPRAZOLE'));
    expect(f?.severity).toBe('critical');
  });
  it('flags IV fluids and CBC for URTI without red flags', () => {
    expect(rules('D-1001', '2026-07-03').filter((r) => r === 'SVC-002').length).toBeGreaterThanOrEqual(2);
  });
  it('flags fever coded with normal temperature', () => expect(rules('D-1001', '2026-07-03')).toContain('VIT-001'));
  it('flags 14-day follow-up with same doctor', () => expect(rules('D-1001', '2026-07-08')).toContain('FUP-001'));
  it('flags pregnancy rules (blood group w/o booking, UTI → O23, NSAID)', () => {
    const r = rules('D-1002');
    expect(r).toContain('SVC-002');
    expect(r).toContain('COD-009');
    expect(r).toContain('SAF-003');
  });
  it('flags paediatric decongestants and missing weight', () => {
    const r = rules('D-1003');
    expect(r).toContain('SAF-004');
    expect(r).toContain('VIT-011');
  });
  it('flags missing injury details and work injury', () => {
    expect(byClaim('D-1004').findings.find((f) => f.ruleId === 'DOC-005')?.title).toMatch(/WHERE|WORK/);
    expect(rules('D-1005')).toContain('DOC-006');
  });
  it('flags MRI without pre-auth and acute back pain imaging', () => {
    expect(rules('D-1007')).toContain('SVC-007');
    expect(rules('D-1007')).toContain('SVC-002');
  });
  it('flags dental procedure without tooth number', () => expect(rules('D-1008')).toContain('SVC-008'));
  it('flags decongestant in hypertension and unsupported TSH', () => {
    expect(rules('D-1009')).toContain('SAF-002');
    expect(rules('D-1009')).toContain('SVC-001');
  });
  it('flags NSAID duplication and QT interaction', () => {
    const titles = byClaim('D-1011').findings.filter((f) => f.ruleId === 'SAF-001').map((f) => f.title).join(' ');
    expect(titles).toMatch(/Duplication/);
    expect(titles).toMatch(/ONDANSETRON|AZITHROMYCIN/);
  });
  it('flags infant formula, non-covered check-up, gender conflict and placeholder vitals', () => {
    expect(rules('D-1012')).toContain('DDX-006');
    expect(rules('D-1012')).toContain('COD-007');
    expect(rules('D-1013')).toContain('SVC-004');
    expect(rules('D-1013')).toContain('VIT-010');
  });
  it('keeps a well-documented tonsillitis claim free of critical/high findings', () => {
    const bad = byClaim('D-1010').findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
    expect(bad.map((f) => f.title)).toEqual([]);
  });
});

describe('rejections', () => {
  it('classifies payer reasons', () => {
    expect(classify('Medication 1-5876-23 is not indicated with diagnosis code N23').id).toBe('MN-DRUG-DX');
    expect(classify('Out Of Price List').id).toBe('TC-PRICE');
    expect(classify('Same Physicain').id).toBe('TC-FOLLOWUP');
    expect(classify("Drug 1-5876-23 is inconsistent with the patient's age").id).toBe('MN-AGE');
    expect(classify('Already rejected/Cancelled at preauthorization').id).toBe('TC-PREAUTH');
    expect(classify('quantity/duration adjusted as it exceeds the maximum limit').id).toBe('MN-QTY');
  });
  it('links statement lines to encounters through the invoice number', () => {
    const linked = linkRejections(parseRejections(demoRejectionTable(), 'demo'), claims);
    expect(linked.every((r) => r.linkedClaim)).toBe(true);
    expect(linked.find((r) => r.serviceCode === '3103210658')?.icdsNamed).toEqual(['J06.9', 'R50.9']);
  });
});

describe('always-rejected watchlist and must-fix level', () => {
  it('matches normal saline, Solpadeine and IV Parafusive but not sodium chloride', () => {
    expect(matchWatch(HOSPITAL_WATCHLIST, '0109222573', 'NS NORMAL SALINE 0.9 %/ml 100 ML/Bottle')?.kind).toBe('replace');
    expect(matchWatch(HOSPITAL_WATCHLIST, '', 'Ns Normal Saline Solution 0.9%/1ml, 500ml/Bottle')).toBeTruthy();
    expect(matchWatch(HOSPITAL_WATCHLIST, '0812258752', 'Solpadeine tablet Capsule, 20 Tablet/Box')?.kind).toBe('warning');
    expect(matchWatch(HOSPITAL_WATCHLIST, '69-188-15', 'PARACETAMOL/parafusive/vitopeine Injection')).toBeTruthy();
    expect(matchWatch(HOSPITAL_WATCHLIST, '', 'SODIUM CHLORIDE 0.9% 100 ml')).toBeUndefined();
    expect(matchWatch(HOSPITAL_WATCHLIST, '', 'DNS DEXTROSE 5% IN NORMAL SALINE')).toBeUndefined();
  });
  it('raises a must-fix replacement finding on the claim line and no "high" level remains', () => {
    const a = auditClaim(byClaim('D-1001', '2026-07-03').claim, formulary, [], HOSPITAL_WATCHLIST);
    const w = a.findings.find((f) => f.ruleId === 'WATCH-REPLACE');
    expect(w?.severity).toBe('critical');
    expect(w?.fix).toMatch(/Sodium Chloride/);
    expect(audits.flatMap((x) => x.findings).some((f) => f.severity === 'high')).toBe(false);
  });
});
