/** CHI Drug Formulary (DDF) + SFDA registry lookups. Data is built by scripts/build_formulary.py. */

export type IndicationRow = [codes: string, indication: string, edits: string, mddAdult: string, mddPaeds: string, ipOnly: 0 | 1];

export interface Ingredient {
  n: string;
  c: string;
  i: IndicationRow[];
  notes: string[];
}

export interface FormularyData {
  version: string;
  ingredients: Record<string, Ingredient>;
  products: [string, string, string, string, string, number | null, string][];
  index: Record<string, number>;
}

export interface DrugMatch {
  root: string;
  trade: string;
  scientific: string;
  route: string;
  legal: string;
  form: string;
  price: number | null;
  atc: string;
  ingredient: Ingredient;
  matchedBy: 'SFDA register no.' | 'GTIN' | 'Trade name' | 'Brand dictionary' | 'Scientific name';
}

/** Common Saudi-market brands whose current register numbers are newer than the formulary snapshot. */
const BRANDS: Record<string, string> = {
  ADOL: 'PARACETAMOL', PANADOL: 'PARACETAMOL', PANADREX: 'PARACETAMOL', FEVADOL: 'PARACETAMOL', TYLENOL: 'PARACETAMOL',
  PARACETAMOL: 'PARACETAMOL', PERFALGAN: 'PARACETAMOL',
  OTRIVIN: 'XYLOMETAZOLINE HYDROCHLORIDE', DECOZAL: 'OXYMETAZOLINE HYDROCHLORIDE', AFRIN: 'OXYMETAZOLINE HYDROCHLORIDE',
  REPARIL: 'AESCIN', FUCIDIN: 'FUSIDIC ACID', DAFLON: 'DIOSMIN,HESPERIDIN', SALINOSE: 'SODIUM CHLORIDE',
  DEFLAT: 'SIMETHICONE', KAFOSED: 'PSEUDOEPHEDRINE HYDROCHLORIDE,TRIPROLIDINE', ARCOXIA: 'ETORICOXIB',
  HYDRALITE: 'SODIUM CHLORIDE,POTASSIUM CHLORIDE,TRI SODIUM CITRATE,DEXTROSE', RINOFED: 'PSEUDOEPHEDRINE HYDROCHLORIDE,TRIPROLIDINE',
  BRUFEN: 'IBUPROFEN', PROFINAL: 'IBUPROFEN', VOLTAREN: 'DICLOFENAC SODIUM', CATAFLAM: 'DICLOFENAC POTASSIUM', ROFENAC: 'DICLOFENAC SODIUM',
  AUGMENTIN: 'AMOXICILLIN,CLAVULANIC ACID', ZINNAT: 'CEFUROXIME AXETIL', ZITHROMAX: 'AZITHROMYCIN', AZIMAC: 'AZITHROMYCIN', KLACID: 'CLARITHROMYCIN',
  CIPROBAY: 'CIPROFLOXACIN', TAVANIC: 'LEVOFLOXACIN', FLAGYL: 'METRONIDAZOLE', ZYRTEC: 'CETIRIZINE HYDROCHLORIDE', CLARITINE: 'LORATADINE', CLARA: 'LORATADINE',
  AERIUS: 'DESLORATADINE', ZANTAC: 'RANITIDINE', NEXIUM: 'ESOMEPRAZOLE', CONTROLOC: 'PANTOPRAZOLE', PANTOMAX: 'PANTOPRAZOLE', PANTROX: 'PANTOPRAZOLE',
  BUSCOPAN: 'BUTYLSCOPOLAMINE BROMIDE', SCOPINAL: 'BUTYLSCOPOLAMINE BROMIDE', PRIMPERAN: 'METOCLOPRAMIDE HYDROCHLORIDE', ZOFRAN: 'ONDANSETRON', ONDANSETRON: 'ONDANSETRON',
  MOTILIUM: 'DOMPERIDONE', VENTOLIN: 'SALBUTAMOL', FARCOLIN: 'SALBUTAMOL', PULMICORT: 'BUDESONIDE', DUPHALAC: 'LACTULOSE',
  XEFO: 'LORNOXICAM', AMBAFEN: 'IBUPROFEN', RELIPAN: 'DICLOFENAC SODIUM', ALLERFIN: 'CHLORPHENIRAMINE MALEATE', TREXON: 'CEFTRIAXONE',
  ROCEPHIN: 'CEFTRIAXONE', DIVIDO: 'DICLOFENAC SODIUM', VOMINORE: 'DIMENHYDRINATE', BIODAL: 'COLECALCIFEROL', RELAXON: 'CHLORZOXAZONE',
  LORINASE: 'PSEUDOEPHEDRINE HYDROCHLORIDE,LORATADINE', DUSPATALIN: 'MEBEVERINE HYDROCHLORIDE', FUCICORT: 'FUSIDIC ACID,BETAMETHASONE VALERATE',
  NASONEX: 'MOMETASONE FUROATE', APISAL: 'SODIUM CHLORIDE', HYDROCORTISONE: 'HYDROCORTISONE', DEXAMETHASONE: 'DEXAMETHASONE SODIUM PHOSPHATE',
  ROXONIN: 'LOXOPROFEN', CEFODOX: 'CEFPODOXIME', SUPRAX: 'CEFIXIME', 'APO-DOXY': 'DOXYCYCLINE', DOXYCYCLINE: 'DOXYCYCLINE',
  TRAMAL: 'TRAMADOL HYDROCHLORIDE', EPIMAG: 'MAGNESIUM CITRATE', LOXTRA: 'LOTEPREDNOL ETABONATE',
};

export class Formulary {
  private byName = new Map<string, string>(); // scientific name → root
  private byTradeWord = new Map<string, Set<string>>();

  constructor(public data: FormularyData) {
    for (const [root, ing] of Object.entries(data.ingredients)) {
      const key = ing.n.toUpperCase();
      if (!this.byName.has(key) || ing.i.length > (data.ingredients[this.byName.get(key)!]?.i.length ?? 0)) this.byName.set(key, root);
    }
    for (const p of data.products) {
      const w = firstWord(p[1]);
      if (w.length < 4) continue;
      if (!this.byTradeWord.has(w)) this.byTradeWord.set(w, new Set());
      this.byTradeWord.get(w)!.add(p[0]);
    }
  }

  private fromProduct(idx: number, matchedBy: DrugMatch['matchedBy']): DrugMatch {
    const p = this.data.products[idx];
    const ing = this.data.ingredients[p[0]];
    return { root: p[0], trade: p[1], scientific: ing?.n ?? '', route: p[2], legal: p[3], form: p[4], price: p[5], atc: p[6], ingredient: ing, matchedBy };
  }

  private fromRoot(root: string, trade: string, matchedBy: DrugMatch['matchedBy']): DrugMatch {
    const ing = this.data.ingredients[root];
    const p = this.data.products.find((x) => x[0] === root);
    return { root, trade, scientific: ing.n, route: p?.[2] ?? '', legal: p?.[3] ?? '', form: p?.[4] ?? '', price: null, atc: p?.[6] ?? '', ingredient: ing, matchedBy };
  }

  rootByScientific(name: string): string | undefined {
    return this.byName.get(name.toUpperCase());
  }

  /** Resolve a billed medication by SFDA register no. → GTIN → brand dictionary → trade name. */
  lookup(code: string, gtin: string | undefined, desc: string): DrugMatch | null {
    const k = (code || '').trim().toUpperCase();
    if (k && this.data.index[k] !== undefined) return this.fromProduct(this.data.index[k], 'SFDA register no.');
    const g = (gtin || '').replace(/^0+/, '');
    if (g && g.length > 6 && !/^9{6,}/.test(g) && this.data.index[g] !== undefined) return this.fromProduct(this.data.index[g], 'GTIN');
    const w = firstWord(desc);
    const brand = BRANDS[w];
    if (brand) {
      const root = this.rootByScientific(brand);
      if (root) return this.fromRoot(root, desc, 'Brand dictionary');
      // Known ingredient that is not part of the CHI formulary: still useful for safety rules.
      return { root: '', trade: desc, scientific: brand, route: '', legal: '', form: '', price: null, atc: '', ingredient: { n: brand, c: '', i: [], notes: [] }, matchedBy: 'Brand dictionary' };
    }
    const roots = this.byTradeWord.get(w);
    if (roots && roots.size === 1) return this.fromRoot([...roots][0], desc, 'Trade name');
    return null;
  }

  search(q: string, limit = 25): DrugMatch[] {
    const t = q.trim().toUpperCase();
    if (t.length < 2) return [];
    const out: DrugMatch[] = [];
    const seen = new Set<string>();
    if (this.data.index[t] !== undefined) {
      const m = this.fromProduct(this.data.index[t], 'SFDA register no.');
      out.push(m);
      seen.add(m.root + m.trade);
    }
    for (let i = 0; i < this.data.products.length && out.length < limit; i++) {
      const p = this.data.products[i];
      const ing = this.data.ingredients[p[0]];
      if (p[1].toUpperCase().includes(t) || ing?.n.toUpperCase().includes(t)) {
        const key = p[0] + p[1];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(this.fromProduct(i, p[1].toUpperCase().includes(t) ? 'Trade name' : 'Scientific name'));
      }
    }
    return out;
  }
}

function firstWord(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9\- ]/g, ' ').trim().split(/\s+/)[0] ?? '';
}

const plain = (c: string) => c.toUpperCase().replace(/\./g, '');

/** True when the claim ICD falls under a formulary code (or vice versa, for less specific claim codes). */
export function icdMatches(claimCode: string, formularyCode: string): boolean {
  const a = plain(claimCode);
  const b = plain(formularyCode);
  return !!a && !!b && (a.startsWith(b) || b.startsWith(a));
}

export interface IndicationCheck {
  listed: boolean; // ingredient has CHI indications at all
  matched: { icd: string; indication: string; edits: string }[];
  approved: IndicationRow[];
}

export function checkIndication(ing: Ingredient | undefined, icds: string[]): IndicationCheck {
  if (!ing || ing.i.length === 0) return { listed: false, matched: [], approved: [] };
  const matched: IndicationCheck['matched'] = [];
  for (const row of ing.i) {
    for (const fc of row[0].split(',')) {
      for (const icd of icds) {
        if (icdMatches(icd, fc) && !matched.some((m) => m.icd === icd)) matched.push({ icd, indication: row[1], edits: row[2] });
      }
    }
  }
  return { listed: true, matched, approved: ing.i };
}

/** Rank approved indications by word overlap with the clinical note – used to suggest a supporting ICD. */
export function suggestIndications(ing: Ingredient, note: string, max = 3): IndicationRow[] {
  const words = new Set(note.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const syn: Record<string, string[]> = {
    vomiting: ['nausea', 'vomit', 'vomiting', 'emesis'], pain: ['pain', 'ache', 'colic'], fever: ['fever', 'febrile', 'pyrexia'],
    infection: ['infection', 'pus', 'purulent', 'discharge'], allergy: ['allergic', 'itching', 'urticaria', 'sneezing'],
    gastro: ['diarrhea', 'diarrhoea', 'gastroenteritis'], reflux: ['heartburn', 'acidity', 'reflux', 'epigastric'],
  };
  const score = (row: IndicationRow) => {
    const t = row[1].toLowerCase();
    let s = 0;
    for (const w of t.match(/[a-z]{4,}/g) ?? []) if (words.has(w)) s += 2;
    for (const list of Object.values(syn)) if (list.some((w) => t.includes(w)) && list.some((w) => words.has(w))) s += 3;
    if (row[5]) s -= 2; // inpatient-only indications rarely fit an outpatient claim
    return s;
  };
  return [...ing.i].map((r) => [r, score(r)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([r]) => r);
}
