import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeFile, commit } from '../../importer';
import { deriveDataset } from '../../dataset';
import type { ImportBundle } from '../../db';

const root = join(__dirname, '../../..');
const fx = join(root, 'fixtures-local/output(2)-synthetic.xls');
const sm = join(root, 'samples');
const KV = { overrides: {}, review: {}, rules: [], verified: {} };
const file = (p: string) => new File([readFileSync(p)], p.split('/').pop()!);

describe.skipIf(!existsSync(fx))('local fixtures (never committed)', () => {
  it('imports the synthetic output(2) stand-in with exact control counts', { timeout: 60000 }, async () => {
    const [s] = await analyzeFile(file(fx));
    expect(s.layout).toBe('his-claims');
    expect(s.payer).toBe('Bupa');
    const { bundle } = commit(s, { mode: 'new-only' }, []);
    expect(bundle.meta.rowsRead).toBe(362);
    expect(bundle.meta.imported).toBe(362);
    const ds = deriveDataset([bundle], KV);
    const lines = ds.claims.flatMap((c) => c.lines);
    expect(lines).toHaveLength(362);
    const by = (c: string) => lines.filter((l) => l.category === c).length;
    expect([by('Medicine'), by('Laboratory'), by('Radiology')]).toEqual([115, 46, 28]);
    expect(ds.claims.every((c) => c.payer === 'Bupa')).toBe(true);
    console.log('encounters', ds.claims.length, 'invoices', new Set(lines.map((l) => l.invoice)).size, 'grouping warnings', ds.claims.filter((c) => c.groupingWarnings.length).length);
  });
  it('real statements import per insurer and months accumulate', { timeout: 60000 }, async () => {
    const bundles: ImportBundle[] = [];
    for (const n of ['974ea649-output.xls', '4caa2315-output.xls', '1db7995e-WAC826_StatementOfAccount_07-2026.xlsx', 'c82e0319-CLPROVSTM04_24522_591411_001.XLSX']) {
      for (const s of await analyzeFile(file(join(sm, n)))) bundles.push(commit(s, { mode: 'new-only' }, bundles).bundle);
    }
    const ds = deriveDataset(bundles, KV);
    const payers = new Set(ds.rejections.map((r) => r.payer));
    expect(payers).toEqual(new Set(['Bupa', 'Tawuniya']));
    expect(new Set(ds.claims.map((c) => c.period))).toEqual(new Set(['2026-06', '2026-07']));
    console.log(JSON.stringify({ claimRows: ds.claims.reduce((s, c) => s + c.lines.length, 0), encounters: ds.claims.length, rej: ds.rejections.length, tawLinked: ds.rejections.filter((r) => r.payer === 'Tawuniya' && r.link !== 'unmatched').length, adjustments: ds.adjustments.length, info: ds.informationalLines }));
  });
});
