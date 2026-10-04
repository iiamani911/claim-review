import { useMemo, useState } from 'react';
import { useData } from '../App';
import { checkIndication, type DrugMatch } from '../lib/formulary';
import { AGE_RULES, classesOf, isTopical } from '../lib/kb/drugs';
import { Empty, Sev } from '../ui';

const EDIT_LABEL: Record<string, string> = {
  PA: 'Prior authorisation', QL: 'Quantity limit', MD: 'Specialist prescriber', AGE: 'Age restriction', ST: 'Step therapy', CU: 'Concurrent use', EU: 'Emergency use', PE: 'Protocol', IP: 'Inpatient',
};

export default function DrugChecker() {
  const { formulary } = useData();
  const [q, setQ] = useState('pantoprazole');
  const [icd, setIcd] = useState('K21.9, R51');
  const [pick, setPick] = useState<DrugMatch | null>(null);
  const results = useMemo(() => (formulary ? formulary.search(q, 30) : []), [formulary, q]);
  const drug = pick ?? results[0] ?? null;
  const icds = icd.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const chk = drug ? checkIndication(drug.ingredient, icds) : null;

  if (!formulary) return <div className="card"><Empty title="Loading CHI formulary…" /></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">CHI Drug Formulary · {formulary.data.version}</span>
          <h1>Drug ↔ ICD checker</h1>
          <p>Look up any SFDA product by trade name, scientific name or register number and test it against the diagnosis codes before prescribing or submitting.</p>
        </div>
      </div>
      <div className="filters">
        <input id="drug-q" className="input" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="Trade name, scientific name or SFDA register no." aria-label="Drug" />
        <input id="drug-icd" className="input" value={icd} onChange={(e) => setIcd(e.target.value)} placeholder="ICD codes, e.g. J02.9, R50.9" aria-label="Diagnosis codes" />
      </div>
      <div className="split">
        <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}>
          {results.length ? (
            <table>
              <thead><tr><th>Product</th><th>Scientific name</th><th>Route</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.root + r.trade} className="clickable" aria-selected={drug?.trade === r.trade} onClick={() => setPick(r)}>
                    <td><b>{r.trade}</b><br /><span className="faint">{r.legal}{r.price ? ` · SAR ${r.price}` : ''}</span></td>
                    <td>{r.scientific}</td>
                    <td className="muted">{r.route}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty title="No product found">Try the scientific name or part of the trade name.</Empty>}
        </div>
        <div className="detail">
          {drug && chk && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <span className="eyebrow">{drug.ingredient.c || 'Not in CHI indication list'}</span>
                <h2>{drug.scientific}</h2>
                <span className="muted">{drug.trade} · {drug.form} · {drug.route} · ATC {drug.atc || '—'}</span>
              </div>
              <div className="fix" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
                {!icds.length ? <span>Enter diagnosis codes to test.</span>
                  : !chk.listed ? <span><Sev s="medium" /> Not in the CHI formulary indication list – expect PBM review.</span>
                  : chk.matched.length ? <span><span className="sev sev-clean">Indicated</span> Covered indication for {chk.matched.map((m) => `${m.icd} (${m.indication}${m.edits ? `; edits ${m.edits}` : ''})`).join(', ')}.</span>
                  : <span><Sev s="critical" /> Not indicated for {icds.join(', ')}. The payer will reject under MN-1-1 / PBM unless an approved indication is coded.</span>}
              </div>
              {(() => {
                const cls = [...classesOf(drug.scientific + ' ' + drug.trade)];
                const ages = AGE_RULES.filter((r) => r.re.test(drug.scientific));
                return (
                  <>
                    {cls.length > 0 && <p style={{ fontSize: 13 }}><b>Safety classes:</b> {cls.join(', ')}{isTopical(drug.trade, drug.route) ? ' (topical)' : ''}</p>}
                    {ages.length > 0 && <ul className="list" style={{ fontSize: 13 }}>{ages.map((a) => <li key={a.effect}>{a.effect}</li>)}</ul>}
                  </>
                );
              })()}
              <div>
                <h3 style={{ marginBottom: 6 }}>Approved indications ({drug.ingredient.i.length})</h3>
                <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Indication</th><th>ICD-10</th><th>Edits</th></tr></thead>
                    <tbody>
                      {drug.ingredient.i.map((r) => (
                        <tr key={r[0] + r[1]}>
                          <td>{r[1]}{r[5] ? <span className="faint"> · inpatient</span> : null}{r[3] && <><br /><span className="faint" style={{ fontSize: 11 }}>MDD adult: {r[3]}</span></>}</td>
                          <td><span className="codes">{r[0].split(',').map((c) => <span className="code" key={c} style={icds.some((x) => x.replace('.', '').startsWith(c.replace('.', ''))) ? { borderColor: 'var(--good)', background: 'var(--good-soft)' } : undefined}>{c}</span>)}</span></td>
                          <td className="muted" style={{ fontSize: 12 }}>{r[2].split(/[,\s]+/).filter(Boolean).map((e) => EDIT_LABEL[e] ?? e).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {drug.ingredient.notes.length > 0 && (
                <details><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Formulary notes</summary>
                  <ul className="list" style={{ fontSize: 12, marginTop: 8 }}>{drug.ingredient.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
