/** Derives the analysable dataset (encounters, rejections, reference data) from stored imports. */
import type { Claim, FinancialAdjustment, Payer, Rejection } from './lib/types';
import { buildClaims, canon, money, type ClaimRow } from './lib/parse';
import { applyOverride, linkRejections, parseStatementRow } from './lib/rejections';
import type { FormularyData } from './lib/formulary';
import type { ImportBundle, KV } from './db';

export interface PriceEntry { code: string; desc: string; price: number; importId: string; rowNo: number }
export interface ApprovalEntry { code: string; desc: string; rule: string; importId: string; rowNo: number }

export interface Dataset {
  claims: Claim[];
  rejections: Rejection[];
  adjustments: FinancialAdjustment[];
  informationalLines: number;
  priceLists: Record<Payer, Map<string, PriceEntry>>;
  priceListMeta: Record<Payer, { filename: string; version?: string; uploadedAt: string }[]>;
  approvalLists: Record<Payer, Map<string, ApprovalEntry>>;
  approvalMeta: Record<Payer, { filename: string; version?: string; uploadedAt: string }[]>;
  formulary: { data: FormularyData; filename: string; uploadedAt: string } | null;
  isDemo: boolean;
}

const codeKey = (c: string) => c.replace(/\s+/g, '').toUpperCase();

export function deriveDataset(bundles: ImportBundle[], kv: KV): Dataset {
  const real = bundles.filter((b) => !b.meta.demo);
  // Real data replaces demo data entirely – never mixed in reporting.
  const use = (real.length ? real : bundles).filter((b) => b.meta.status === 'active');
  const claims: Claim[] = [];
  const rejections: Rejection[] = [];
  const adjustments: FinancialAdjustment[] = [];
  let informationalLines = 0;
  const priceLists: Dataset['priceLists'] = { Bupa: new Map(), Tawuniya: new Map() };
  const approvalLists: Dataset['approvalLists'] = { Bupa: new Map(), Tawuniya: new Map() };
  const priceListMeta: Dataset['priceListMeta'] = { Bupa: [], Tawuniya: [] };
  const approvalMeta: Dataset['approvalMeta'] = { Bupa: [], Tawuniya: [] };
  let formulary: Dataset['formulary'] = null;

  for (const b of use) {
    const m = b.meta;
    if (m.fileType === 'claims' && m.mapping) {
      const rows: ClaimRow[] = b.rows.filter((r) => r.payer).map((r) => ({ rowNo: r.rowNo, c: canon(r.values, m.mapping!), payer: r.payer! }));
      claims.push(...buildClaims(rows, m.id, m.filename));
    } else if (m.fileType === 'rejections') {
      for (const r of b.rows) {
        const payer = r.payer ?? m.payer;
        if (!payer) continue;
        const out = parseStatementRow(m.layout, r.values, m.mapping, { importId: m.id, rowNo: r.rowNo, payer, source: m.filename, period: m.periods[0] ?? '' });
        if (out === 'info') informationalLines++;
        else if (out && 'causeId' in out) rejections.push(applyOverride(out, kv.overrides[out.id]));
        else if (out) adjustments.push(out);
      }
    } else if (m.fileType === 'reference') {
      if (m.refKind === 'drug-formulary' && b.payload) {
        if (!formulary || m.uploadedAt > formulary.uploadedAt) formulary = { data: b.payload, filename: m.filename, uploadedAt: m.uploadedAt };
      } else if ((m.refKind === 'price-list' || m.refKind === 'approval-list') && m.mapping && m.payer) {
        const target = m.refKind === 'price-list' ? priceLists[m.payer] : approvalLists[m.payer];
        for (const r of b.rows) {
          const c = canon(r.values, m.mapping);
          if (!c.code) continue;
          if (m.refKind === 'price-list') {
            const price = money(c.price);
            if (price > 0) (target as Map<string, PriceEntry>).set(codeKey(c.code), { code: c.code, desc: c.desc ?? '', price, importId: m.id, rowNo: r.rowNo });
          } else (target as Map<string, ApprovalEntry>).set(codeKey(c.code), { code: c.code, desc: c.desc ?? '', rule: c.rule ?? '', importId: m.id, rowNo: r.rowNo });
        }
        (m.refKind === 'price-list' ? priceListMeta : approvalMeta)[m.payer].push({ filename: m.filename, version: m.version, uploadedAt: m.uploadedAt });
      }
    }
  }
  return {
    claims,
    rejections: linkRejections(rejections, claims),
    adjustments,
    informationalLines,
    priceLists,
    priceListMeta,
    approvalLists,
    approvalMeta,
    formulary,
    isDemo: real.length === 0 && bundles.length > 0,
  };
}

export { codeKey };
