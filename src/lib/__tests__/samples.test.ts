import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTables, detect, buildClaims } from '../parse';
import { Formulary } from '../formulary';
import { auditAll } from '../engine';
import { parseRejections, linkRejections } from '../rejections';

const dir = join(__dirname, '../../../samples');
const has = existsSync(dir);

describe.skipIf(!has)('real sample files (local only, never committed)', () => {
  it('parses, audits and links', () => {
    const f = new Formulary(JSON.parse(readFileSync(join(__dirname, '../../../public/data/formulary.json'), 'utf8')));
    const claims = [], rej = [];
    for (const n of readdirSync(dir)) {
      const buf = readFileSync(join(dir, n));
      for (const t of detect(readTables(n, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))) {
        if (t.kind === 'claims') claims.push(...buildClaims(t.records, n));
        else if (t.kind.startsWith('rejections')) rej.push(...parseRejections(t, n));
      }
    }
    const audits = auditAll(claims, f);
    const linked = linkRejections(rej, claims);
    expect(claims.length).toBeGreaterThan(100);
    const out = process.env.AUDIT_OUT;
    if (out) writeFileSync(out, JSON.stringify({ audits: audits.map((a) => ({ ...a, claim: { ...a.claim, patientName: undefined } })), rejections: linked }, null, 1));
  });
});
