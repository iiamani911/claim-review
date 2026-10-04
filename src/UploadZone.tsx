import { useRef, useState } from 'react';
import { useData } from './App';
import type { Section } from './lib/types';
import { ingestFile, SECTION_LABEL } from './store';
import { Icon, int } from './ui';

const HELP: Record<Section, string> = {
  medical: 'Drop the HIS claim export (output.xls) for claims you are about to submit. Every encounter is audited medically.',
  rejection: 'Drop the payer statements (Tawuniya / Waseel, Bupa CLPROVSTM…) and the HIS export of the rejected claims. Rejected claims get the same full medical audit to show the root cause.',
  technical: 'Drop the HIS export for the technical audit. Price-list, contract and pre-authorisation rules will be added when you send the technical data.',
};

/** Upload area bound to one section: files dropped here are treated according to that section. */
interface Report { name: string; ok: boolean; text: string }

export default function UploadZone({ section, compact }: { section: Section; compact?: boolean }) {
  const { files, addFiles, removeFile, isDemo, go } = useData();
  const [report, setReport] = useState<Report[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const mine = files.filter((f) => f.section === section);

  async function handle(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setMsg('');
    try {
      const loaded = (await Promise.all([...list].map((f) => ingestFile(f, section).catch((e) => [{ kind: 'error', name: f.name, error: String(e) } as never])))).flat();
      const rep: Report[] = [];
      const good: typeof loaded = [];
      for (const f of loaded as (typeof loaded[number] & { error?: string })[]) {
        if (f.error) { rep.push({ name: f.name, ok: false, text: `Could not read the file (${f.error}). Save it as .xlsx or .csv and try again.` }); continue; }
        if (f.kind === 'unknown') {
          rep.push({ name: f.name, ok: false, text: `File type not recognised. Columns found: ${f.header.join(', ') || 'none'}. A claim export needs a claim/visit number, a service and a diagnosis (ICD) or patient column; a statement needs service, reason and rejected amount.` });
          continue;
        }
        if (f.kind === 'claims' && !f.claims.length) {
          rep.push({ name: f.name, ok: false, text: `Recognised as a claim export (${int(f.rows)} rows) but no encounters could be built: the claim/visit number column is empty. Columns: ${f.header.filter(Boolean).slice(0, 25).join(', ')}.` });
          continue;
        }
        good.push(f);
        const months = [...new Set([...f.claims.map((c) => c.serviceDate.slice(0, 7)), ...f.rejections.map((r) => r.serviceDate.slice(0, 7))].filter(Boolean))].sort();
        const flagged = f.claims.length;
        rep.push({
          name: f.name, ok: true,
          text: f.kind === 'claims'
            ? `${int(f.rows)} rows → ${int(flagged)} encounters${months.length ? ` (${months.join(', ')})` : ''} added to ${SECTION_LABEL[f.section]}.${f.claims.every((c) => !c.diagnoses.length) ? ' Warning: no ICD codes were found in this file.' : ''}`
            : `${int(f.rejections.length)} rejected lines added to Rejection analysis.${f.note ? ' ' + f.note : ''}`,
        });
      }
      if (good.length) addFiles(good);
      setReport(rep);
      setMsg('');
      const firstClaims = good.find((f) => f.kind === 'claims' && f.section === section);
      if (firstClaims) go(section === 'medical' ? 'audit' : section === 'technical' ? 'technical' : 'rejections', { fileId: firstClaims.id });
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section className="upload-zone" aria-label={`Upload to ${SECTION_LABEL[section]}`}>
      <div
        className={`drop ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      >
        <Icon name="upload" />
        <div style={{ textAlign: 'left' }}>
          <b>{busy ? 'Reading files…' : `Upload to ${SECTION_LABEL[section]}`}</b>
          <p className="muted" style={{ fontSize: 13 }}>{HELP[section]} Several files and months at once (.xls, .xlsx, .csv).</p>
        </div>
        <input ref={input} id={`file-input-${section}`} type="file" multiple accept=".xls,.xlsx,.csv,.txt" hidden onChange={(e) => handle(e.target.files)} />
      </div>
      {msg && <div className="banner" role="status">{msg}</div>}
      {report.length > 0 && (
        <div className="report" role="status">
          {report.map((r) => <div key={r.name} className={r.ok ? 'ok' : 'bad'}><b>{r.ok ? '✓' : '✗'} {r.name}</b> – {r.text}</div>)}
        </div>
      )}
      {mine.length > 0 && (
        <div className="file-chips">
          {mine.map((f) => (
            <span key={f.id} className="file-chip">
              <b>{f.name}</b>{f.demo && <span className="faint"> · demo</span>}
              <span className="faint num">{f.claims.length ? `${int(f.claims.length)} enc.` : `${int(f.rejections.length)} lines`}</span>
              {!f.demo && <button className="btn small ghost" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}><Icon name="close" /></button>}
            </span>
          ))}
          {isDemo && <span className="faint" style={{ fontSize: 12 }}>Demo files are replaced as soon as you upload your own.</span>}
        </div>
      )}
    </section>
  );
}
