import { useMemo } from 'react';
import { useData } from '../App';
import { TECHNICAL_RULES, viewAudit } from '../lib/engine';
import { RULES } from '../lib/kb/rules';
import UploadZone from '../UploadZone';
import { AuditWorkspace } from './Audit';

export default function TechnicalPage() {
  const { audits } = useData();
  const mine = useMemo(() => audits.filter((a) => a.claim.section === 'technical').map((a) => viewAudit(a, 'technical')), [audits]);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Phase 2 · billing, contract & approvals</span>
          <h1>Technical audit</h1>
          <p>Upload claims here for the technical review. The technical rules already available run now; price-list, contract, pre-authorisation and benefit rules will be added when you share the technical data.</p>
        </div>
      </div>
      <UploadZone section="technical" compact />
      <div className="phase-note">
        <b>Running now:</b> {RULES.filter((r) => TECHNICAL_RULES.has(r.id)).map((r) => r.name).join(' · ')}.
        <br /><b>Waiting for your data:</b> payer price lists (out-of-price-list), contracted service codes, pre-authorisation list per payer, deductible/co-pay tables per class, eligibility and benefit limits.
      </div>
      <AuditWorkspace audits={mine} view="technical" exportName="WAD_technical_audit.xlsx" emptyText="Upload an HIS claim export above to run the technical checks." />
    </>
  );
}
