import { useData } from '../App';
import type { Section } from '../lib/types';
import { SECTION_LABEL } from '../store';
import { Icon, int } from '../ui';

const KIND_LABEL: Record<string, string> = {
  claims: 'HIS claim export',
  'rejections-waseel': 'Tawuniya / Waseel statement',
  'rejections-bupa': 'Bupa CLPROVSTM rejections',
  'rejections-generic': 'Payer rejection list',
  unknown: 'Not recognised',
};

export default function ImportPage() {
  const { files, removeFile, clearAll, isDemo, setSection, go } = useData();
  const months = (f: (typeof files)[number]) => {
    const ms = [...new Set([...f.claims.map((c) => c.serviceDate.slice(0, 7)), ...f.rejections.map((r) => r.serviceDate.slice(0, 7))].filter(Boolean))].sort();
    return ms.length ? (ms.length > 1 ? `${ms[0]} → ${ms[ms.length - 1]}` : ms[0]) : '—';
  };
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Data</span>
          <h1>All files</h1>
          <p>Every uploaded file and the section it belongs to. Upload from the section pages: Medical audit (claims to submit), Rejection analysis (rejected claims and payer statements) and Technical audit. You can move a claim file to another section here. Files stay on this computer only.</p>
        </div>
        <div className="filters">
          <button className="btn" onClick={() => go('audit')}>Upload to Medical audit</button>
          <button className="btn" onClick={() => go('rejections')}>Upload to Rejection analysis</button>
          <button className="btn" onClick={() => go('technical')}>Upload to Technical audit</button>
        </div>
      </div>
      <section className="card">
        <div className="card-head"><h2>Loaded {isDemo ? '(demo)' : ''}</h2>{!isDemo && <button className="btn small" onClick={clearAll}><Icon name="trash" />Remove all</button>}</div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>File</th><th>Detected as</th><th>Section</th><th>Months</th><th className="r">Encounters</th><th className="r">Rejected lines</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.name}</b>{f.sheet && f.sheet !== f.name && <span className="faint"> · {f.sheet}</span>}</td>
                  <td>{KIND_LABEL[f.kind]}</td>
                  <td>
                    {f.kind === 'claims' && !f.demo ? (
                      <select id={`sec-${f.id}`} className="select" value={f.section} onChange={(e) => setSection(f.id, e.target.value as Section)} aria-label={`Section for ${f.name}`}>
                        {(['medical', 'rejection', 'technical'] as Section[]).map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
                      </select>
                    ) : SECTION_LABEL[f.section]}
                  </td>
                  <td className="num">{months(f)}</td>
                  <td className="r num">{int(f.claims.length)}</td>
                  <td className="r num">{int(f.rejections.length)}</td>
                  <td className="r">{!f.demo && <button className="btn small ghost" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}><Icon name="trash" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
