import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Formulary } from '../formulary';
import { auditAll } from '../engine';
import { HOSPITAL_WATCHLIST } from '../kb/watchlist';
import { buildClaims, readTables, detect } from '../parse';
import { CATS, briefFix, catOf, checkSheet } from '../precheck';
import { demoClaimRecords } from './fixtures';

const formulary = new Formulary(JSON.parse(readFileSync(join(__dirname, '../../../public/data/formulary.json'), 'utf8')));
const tag = (cs: ReturnType<typeof buildClaims>) => cs.map((c) => ({ ...c, id: `medical:${c.id}`, section: 'medical' as const }));

function run(records: Record<string, string>[], header: string[]) {
  const audits = auditAll(tag(buildClaims(records, 'x')), formulary, HOSPITAL_WATCHLIST);
  return checkSheet({ name: 'x', section: 'medical', header, records }, new Map(audits.map((a) => [a.claim.id, a])), '2026-10-01');
}

describe('highlighted sheet', () => {
  const recs = demoClaimRecords();
  const header = Object.keys(recs[0]);
  const ch = run(recs, header);

  it('keeps every row and puts each problem in a category with a brief fix', () => {
    expect(ch.rows.length).toBe(recs.length);
    const issues = ch.rows.flatMap((r) => r.issues);
    expect(issues.length).toBeGreaterThan(10);
    for (const x of issues) {
      expect(CATS[x.cat]).toBeTruthy();
      expect(x.fix.length).toBeLessThanOrEqual(120);
      expect(x.cols.length).toBeGreaterThan(0);
    }
  });

  it('colours the always-rejected line on its own row', () => {
    const i = recs.findIndex((r) => /solpad/i.test(Object.values(r).join(' ')));
    expect(ch.rows[i].issues.some((x) => x.cat === 'coverage' && /Solpadeine/i.test(x.text))).toBe(true);
    expect(ch.rows[i].level).toBe('must');
  });

  it('adds technical checks on raw rows', () => {
    const bad = recs.map((r) => ({ ...r }));
    const memberKey = Object.keys(bad[0]).find((k) => /membership|memberid/i.test(k))!;
    const amountKey = Object.keys(bad[0]).find((k) => /billedamount/i.test(k))!;
    const codeKey = Object.keys(bad[0]).find((k) => /servicecode/i.test(k))!;
    for (const r of bad) { r[memberKey] = ''; }
    bad[0][amountKey] = '0';
    bad[1][codeKey] = '';
    const c2 = run(bad, header);
    const all = c2.rows.flatMap((r) => r.issues.map((x) => x.ruleId));
    expect(all).toContain('TEC-010');
    expect(c2.rows[0].issues.map((x) => x.ruleId)).toContain('TEC-003');
    expect(c2.rows[1].issues.map((x) => x.ruleId)).toContain('TEC-002');
  });

  it('maps rules to colours', () => {
    expect(catOf({ ruleId: 'DOC-001' })).toBe('doc');
    expect(catOf({ ruleId: 'VIT-001' })).toBe('vitals');
    expect(catOf({ ruleId: 'SVC-007' })).toBe('technical');
    expect(catOf({ ruleId: 'WATCH-REPLACE' })).toBe('technical');
    expect(catOf({ ruleId: 'WATCH-WARN' })).toBe('coverage');
    expect(briefFix({ ruleId: 'VIT-009', title: 'Vital signs missing: pulse, respiratory rate', fix: '' } as never)).toBe('Record pulse, respiratory rate');
  });
});

const sample = join(__dirname, '../../../samples/974ea649-output.xls');
describe.skipIf(!existsSync(sample))('real export (local only)', () => {
  it('checks the July export', { timeout: 60000 }, () => {
    const buf = readFileSync(sample);
    const t = detect(readTables('s.xls', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer))[0];
    const ch = run(t.records, t.header);
    const cnt: Record<string, number> = {};
    for (const r of ch.rows) for (const x of r.issues) cnt[x.ruleId] = (cnt[x.ruleId] ?? 0) + 1;
    if (process.env.CHECK_OUT) writeFileSync(process.env.CHECK_OUT, JSON.stringify({ rows: ch.rows.length, must: ch.mustRows, counts: ch.counts, rules: cnt, sample: ch.rows.filter((r) => r.issues.length).slice(0, 6).map((r) => r.issues.map((x) => [x.cat, x.text, x.fix, x.cols.map((c) => t.header[c])])) }, null, 1));
    expect(ch.rows.length).toBe(t.records.length);
  });
});

import { autoFix } from '../autofix';

describe('auto-correction', () => {
  const header = ['ClaimNo', 'MRN', 'Age', 'Temperature', 'BP', 'Height', 'Weight', 'ICD1', 'diag 2', 'service code', 'ServiceDescription'];
  const row = (o: Record<string, string>) => ({ claimno: '1', mrn: '9', age: '30Y', temperature: '37', bp: '120/80', height: '170', weight: '70', icd1: 'J02.9', diag2: '-1', servicecode: 'C1', servicedescription: 'Consultation', ...o });
  it('corrects only unambiguous data-entry mistakes', () => {
    const recs = [
      row({ temperature: '3703' }), row({ temperature: '385' }), row({ temperature: '101.3' }), row({ temperature: '1' }),
      row({ bp: '80/120' }), row({ bp: '130-85' }), row({ height: '1.65' }), row({ age: '8M', weight: '7800' }),
      row({ icd1: 'j029', diag2: 'r50.9' }), row({ servicecode: '0109222573', servicedescription: 'NS NORMAL SALINE 0.9 %/ml 100 ML/Bottle' }),
      row({ servicecode: 'SC100', servicedescription: 'Sodium Chloride 0.9% 100 ml' }),
    ];
    const { records, changes } = autoFix(header, recs);
    expect(records.map((r) => r.temperature).slice(0, 4)).toEqual(['37', '38.5', '38.5', '1']);
    expect(records[4].bp).toBe('120/80');
    expect(records[5].bp).toBe('130/85');
    expect(records[6].height).toBe('165');
    expect(records[7].weight).toBe('7.8');
    expect(records[8].icd1).toBe('J02.9');
    expect(records[8].diag2).toBe('R50.9');
    expect(records[9].servicecode).toBe('SC100');
    expect(records[0].icd1).toBe('J02.9');
    expect(recs[0].temperature).toBe('3703'); // input untouched
    expect(changes.every((c) => c.from !== c.to && c.why)).toBe(true);
    expect(changes.some((c) => c.row === 3)).toBe(false); // temperature 1 cannot be guessed
  });
  it('leaves normal saline when no contracted item is in the sheet', () => {
    const { records } = autoFix(header, [row({ servicecode: '0109222573', servicedescription: 'NS NORMAL SALINE 0.9 %/ml 100 ML/Bottle' })]);
    expect(records[0].servicecode).toBe('0109222573');
  });
});
