/** Builds the formulary dataset from an uploaded CHI Drug Formulary (DDF) workbook – same logic as scripts/build_formulary.py. */
import type { FormularyData, IndicationRow, Ingredient } from './formulary';
import type { Table } from './parse';

const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
const n = (s: string) => clean(s).toUpperCase();

function headerIndex(rows: string[][], must: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(n);
    if (must.every((m) => h.includes(m))) return i;
  }
  return -1;
}

export function isDdfWorkbook(tables: Table[]): boolean {
  return tables.some((t) => /indication/i.test(t.sheet)) && tables.some((t) => /sfda/i.test(t.sheet));
}

export function buildFormularyFromTables(tables: Table[], version: string): FormularyData {
  const ind = tables.find((t) => /indication/i.test(t.sheet));
  const sf = tables.find((t) => /sfda/i.test(t.sheet));
  if (!ind || !sf) throw new Error('Workbook must contain the "Indication" and "Mapped to SFDA" sheets.');
  const ih = headerIndex(ind.rows, ['INDICATION', 'ICD 10 CODE']);
  const sh = headerIndex(sf.rows, ['REGISTERNUMBER', 'SCIENTIFICDESCRIPTIONCODEROOT']);
  if (ih < 0 || sh < 0) throw new Error('Could not find the formulary header rows.');
  const H = ind.rows[ih].map(n);
  const col = (name: string) => H.findIndex((h) => h === name);
  const ci = {
    indication: col('INDICATION'), icd: col('ICD 10 CODE'), cls: col('DRUG PHARMACOLOGICAL CLASS'), sci: col('SCIENTIFIC NAME'), root: col('SCIENTIFIC DESCRIPTION CODE ROOT'),
    edits: col('PRESCRIBING EDITS'), mddA: col('MDD ADULTS'), mddP: col('MDD PEDIATRICS'), notes: col('NOTES'), ptype: col('PATIENT TYPE'),
  };
  const ingredients: Record<string, Ingredient> = {};
  const seen = new Map<string, Set<string>>();
  for (const r of ind.rows.slice(ih + 1)) {
    const root = clean(r[ci.root]);
    if (!root) continue;
    const ing = (ingredients[root] ??= { n: clean(r[ci.sci]), c: clean(r[ci.cls]), i: [], notes: [] });
    const codes = [...new Set(clean(r[ci.icd]).toUpperCase().split(/[,;\s]+/).filter(Boolean))].sort().join(',');
    const key = `${codes}|${clean(r[ci.indication])}`;
    const s = seen.get(root) ?? new Set<string>();
    seen.set(root, s);
    if (codes && !s.has(key)) {
      s.add(key);
      const title = clean(r[ci.indication]).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      ing.i.push([codes, title, clean(r[ci.edits]), clean(r[ci.mddA]).slice(0, 80), clean(r[ci.mddP]).slice(0, 80), clean(r[ci.ptype]) === 'IP' ? 1 : 0] as IndicationRow);
    }
    const note = clean(r[ci.notes]).slice(0, 420);
    if (note && ing.notes.length < 4 && !ing.notes.includes(note)) ing.notes.push(note);
  }
  const S = sf.rows[sh].map((h) => clean(h).toUpperCase().replace(/\s+/g, ''));
  const sc = (name: string) => S.findIndex((h) => h === name);
  const si = {
    reg: sc('REGISTERNUMBER'), old: sc('OLDREGISTERNUMBER'), root: sc('SCIENTIFICDESCRIPTIONCODEROOT'), sci: sc('SCIENTIFICNAME'), trade: sc('TRADENAME'),
    route: sc('ADMINISTRATIONROUTE'), legal: sc('LEGALSTATUS'), form: sc('PHARMACEUTICALFORM'), price: sc('PUBLICPRICE'), atc: sc('ATCCODE1'), gtin: sc('GTIN'),
  };
  const products: FormularyData['products'] = [];
  const index: Record<string, number> = {};
  for (const r of sf.rows.slice(sh + 1)) {
    const root = clean(r[si.root]);
    if (!root) continue;
    ingredients[root] ??= { n: clean(r[si.sci]), c: '', i: [], notes: [] };
    const price = parseFloat(clean(r[si.price]));
    products.push([root, clean(r[si.trade]), clean(r[si.route]), clean(r[si.legal]), clean(r[si.form]), Number.isFinite(price) ? price : null, clean(r[si.atc])]);
    const idx = products.length - 1;
    for (const k of [clean(r[si.reg]), clean(r[si.old])]) if (k && index[k.toUpperCase()] === undefined) index[k.toUpperCase()] = idx;
    const g = clean(r[si.gtin]).replace(/^0+/, '');
    if (g && index[g] === undefined) index[g] = idx;
  }
  return { version, ingredients, products, index };
}
