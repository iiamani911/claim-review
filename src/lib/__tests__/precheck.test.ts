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
