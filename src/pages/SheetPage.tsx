import UploadZone from '../UploadZone';
import SheetCheckView from './SheetCheck';

export default function SheetPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Before portal upload</span>
          <h1>Sheet correction</h1>
          <p>Upload the Excel sheet you are about to send to the insurance portal. Data-entry mistakes in <b>vital signs and codes</b> are corrected automatically (dark green). Everything that needs a human – medical, coding and <b>technical</b> – stays highlighted by colour with a short correction.</p>
        </div>
      </div>
      <UploadZone section="presubmit" compact />
      <SheetCheckView section="presubmit" autofix />
    </>
  );
}
