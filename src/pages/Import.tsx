import { useRef, useState } from 'react';
import { useData } from '../App';
import { ingestFile } from '../store';
import { Icon, int } from '../ui';

const KIND_LABEL: Record<string, string> = {
  claims: 'HIS claim export (medical file)',
  'rejections-waseel': 'Tawuniya / Waseel statement of account',
  'rejections-bupa': 'Bupa CLPROVSTM rejection details',
  'rejections-generic': 'Payer rejection list',
  unknown: 'Not recognised',
};

export default function ImportPage() {
  const { files, addFiles, removeFile, clearAll, isDemo, go } = useData();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function handle(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg('');
    try {
      const loaded = (await Promise.all([...list].map(ingestFile))).flat();
      const bad = loaded.filter((f) => f.kind === 'unknown');
      addFiles(loaded.filter((f) => f.kind !== 'unknown'));
      setMsg(bad.length ? `Could not recognise ${bad.map((b) => b.name).join(', ')}. Expected an HIS claim export (columns ClaimNo, ServiceDescription, ICD1…) or a payer rejection statement.` : `Imported ${loaded.length} table(s).`);
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Data</span>
          <h1>Import files</h1>
          <p>Drop the monthly HIS claim export (the "output.xls" file) and the payer statements. File type is detected automatically. Files are read in this browser and kept only on this computer.</p>
        </div>
      </div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      >
        <Icon name="upload" />
        <h2>{busy ? 'Reading files…' : 'Drop files here or click to choose'}</h2>
        <p className="muted">.xls (HIS text export), .xlsx, .csv · several files at once</p>
        <input ref={input} id="file-input" type="file" multiple accept=".xls,.xlsx,.csv,.txt" hidden onChange={(e) => handle(e.target.files)} />
      </div>
      {msg && <div className="banner" role="status">{msg}</div>}
      <section className="card">
        <div className="card-head"><h2>Loaded {isDemo ? '(demo)' : ''}</h2>{!isDemo && <button className="btn small" onClick={clearAll}><Icon name="trash" />Remove all</button>}</div>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>File</th><th>Detected as</th><th className="r">Rows</th><th className="r">Encounters</th><th className="r">Rejected lines</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.name}</b>{f.sheet && f.sheet !== f.name && <span className="faint"> · {f.sheet}</span>}</td>
                  <td>{KIND_LABEL[f.kind]}</td>
                  <td className="r num">{int(f.rows)}</td>
                  <td className="r num">{int(f.claims.length)}</td>
                  <td className="r num">{int(f.rejections.length)}</td>
                  <td className="r">{!f.demo && <button className="btn small ghost" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}><Icon name="trash" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid g2">
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Medical files (HIS export)</h2>
          <ul className="list muted" style={{ fontSize: 13 }}>
            <li>One row per service line: ClaimNo, MRN, physician, service, ICD1 / diag 2 / diag 3, vitals, chief complaint.</li>
            <li>Encounters are rebuilt per claim + patient + date + doctor.</li>
            <li>If your HIS can add <b>Examination</b>, <b>Plan</b> and <b>SpO2</b> columns, the audit reads them automatically.</li>
          </ul>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Payer statements</h2>
          <ul className="list muted" style={{ fontSize: 13 }}>
            <li>Tawuniya / Waseel statement of account (Reason, Status, Comments).</li>
            <li>Bupa CLPROVSTM04 workbook (Rejection_Details sheet).</li>
            <li>Rejections link to doctors and ICD codes through the invoice number when the matching HIS export is loaded.</li>
          </ul>
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => go('rejections')}>Open rejection analytics</button>
        </div>
      </section>
    </>
  );
}
