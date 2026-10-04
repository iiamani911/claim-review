import { useState, type ReactNode } from 'react';
import type { Severity } from './lib/types';

export const sar = (n: number, digits = 0) => `SAR ${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const int = (n: number) => n.toLocaleString('en-US');
export const pct = (n: number) => `${Math.round(n * 100)}%`;

const ICONS: Record<string, string> = {
  overview: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  import: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3',
  audit: 'M9 11l2 2 4-4M5 4h14v16H5zM9 2v4M15 2v4',
  rejections: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  doctors: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  drugs: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 10l7 7',
  rules: 'M4 5h16M4 12h16M4 19h10',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  copy: 'M8 8h11v12H8zM5 16H4V4h12v1',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  close: 'M6 6l12 12M18 6 6 18',
  technical: 'M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  compare: 'M4 20V8m6 12V4m6 16v-9m6 9V6',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'crit' | 'good' | 'accent' | 'high' }) {
  return (
    <div className={`kpi ${tone ? `tone-${tone}` : ''}`}>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  );
}

/** Critical and high are one reviewer level: “Must fix”. */
const SEV_LABEL: Record<Severity, string> = { critical: 'Must fix', high: 'Must fix', medium: 'Review', low: 'Info' };
export function Sev({ s }: { s: Severity | null }) {
  if (!s) return <span className="sev sev-clean">OK</span>;
  return <span className={`sev sev-${s === 'high' ? 'critical' : s}`}>{SEV_LABEL[s]}</span>;
}

export const sevColor = (s: Severity) => `var(--${s === 'critical' || s === 'high' ? 'crit' : s === 'medium' ? 'med' : 'low'})`;

export function Codes({ codes }: { codes: string[] }) {
  return <span className="codes">{codes.map((c) => <span key={c} className="code">{c}</span>)}</span>;
}

export function Score({ score }: { score: number }) {
  const color = score >= 45 ? 'var(--crit)' : score >= 22 ? 'var(--high)' : score >= 8 ? 'var(--med)' : 'var(--good)';
  return (
    <span className="score" title={`Rejection risk score ${score}/100`}>
      <span className="bar"><i style={{ width: `${Math.max(score, 3)}%`, background: color }} /></span>
      <span className="num">{score}</span>
    </span>
  );
}

export interface BarSeg { value: number; color: string; name: string }
export interface BarRow { key: string; label: string; segs: BarSeg[]; display: string; hint?: string }

/** Horizontal bars to one shared scale, stacked segments separated by a 2px surface gap, hover tooltip per row. */
export function HBars({ rows, onPick, max }: { rows: BarRow[]; onPick?: (key: string) => void; max?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const top = max ?? Math.max(1, ...rows.map((r) => r.segs.reduce((s, x) => s + x.value, 0)));
  return (
    <div className="hbars" role="list">
      {rows.map((r) => (
        <div
          key={r.key}
          role="listitem"
          className="hbar"
          style={{ cursor: onPick ? 'pointer' : undefined, position: 'relative' }}
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onPick?.(r.key)}
        >
          <span className="lbl" title={r.label}>{r.label}</span>
          <span className="trk">
            {r.segs.filter((s) => s.value > 0).map((s) => (
              <i key={s.name} style={{ width: `${(s.value / top) * 100}%`, background: s.color }} />
            ))}
          </span>
          <span className="val">{r.display}</span>
          {hover === r.key && (r.hint || r.segs.length > 1) && (
            <span style={{ position: 'absolute', left: '40%', top: '100%', zIndex: 5, background: 'var(--ink)', color: 'var(--bg)', padding: '6px 9px', borderRadius: 6, fontSize: 12, maxWidth: 360, boxShadow: 'var(--shadow)', pointerEvents: 'none' }}>
              <b>{r.label}</b>
              {r.segs.length > 1 && r.segs.map((s) => <span key={s.name} style={{ display: 'block' }}>{s.name}: {s.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>)}
              {r.hint && <span style={{ display: 'block' }}>{r.hint}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.name}><i style={{ background: i.color }} />{i.name}</span>)}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <button className="btn small" onClick={async (e) => { e.stopPropagation(); setDone(await copyText(text)); setTimeout(() => setDone(null), 1600); }}>
      <Icon name="copy" />{done === null ? label : done ? 'Copied' : 'Select & copy manually'}
    </button>
  );
}
