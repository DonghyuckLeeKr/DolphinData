import React, { useEffect, useId, useRef, useState } from 'react';
import { LifeBuoy, X } from 'lucide-react';
import { isRunningAsAdmin } from '../services/networkTelemetry';
import useModalA11y from '../hooks/useModalA11y';
import DiagnosticPanel from './DiagnosticPanel';

// Reporting is a multi-step task (record, reproduce, submit), so it lives in its own window
// instead of the settings form. Recording keeps running after this window closes.
export default function ReportModal({ config, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [runningAsAdmin, setRunningAsAdmin] = useState(false);
  useModalA11y(dialogRef, onClose);

  useEffect(() => {
    let isMounted = true;
    isRunningAsAdmin()
      .then(elevated => { if (isMounted) setRunningAsAdmin(Boolean(elevated)); })
      .catch(error => console.warn('Failed to check administrator status', error));
    return () => { isMounted = false; };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-panel"
        style={{ maxWidth: '500px' }}
        onClick={event => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
          <X size={20} />
        </button>
        <div className="modal-heading">
          <div className="modal-heading__icon"><LifeBuoy size={20} /></div>
          <div>
            <h2 id={titleId}>문제 신고</h2>
            <p>문제가 생긴 순간을 기록해 개발자에게 보냅니다. 이 창을 닫아도 기록은 계속됩니다.</p>
          </div>
        </div>
        <DiagnosticPanel config={config} admin={runningAsAdmin} />
      </div>
    </div>
  );
}
