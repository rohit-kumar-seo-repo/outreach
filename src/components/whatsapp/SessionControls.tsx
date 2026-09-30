'use client';

import { useState, useTransition } from 'react';
import { addSessionAction, removeSessionAction, sessionControlAction } from '@/app/actions/whatsapp';

function ActionButton({ name, action, label }: { name: string; action: 'start' | 'stop' | 'restart' | 'logout'; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-block">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set('name', name);
          fd.set('action', action);
          start(async () => {
            const res = await sessionControlAction(fd);
            if (res.error) setError(res.error);
          });
        }}
      >
        {pending ? '…' : label}
      </button>
      {error && <p className="mt-1 max-w-56 text-[11px] text-critical">{error}</p>}
    </div>
  );
}

export function SessionActions({ name, status, canRemove }: { name: string; status: string | null; canRemove: boolean }) {
  const [showQr, setShowQr] = useState(false);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {status !== 'WORKING' && <ActionButton name={name} action="start" label="Start" />}
        {status === 'WORKING' && <ActionButton name={name} action="stop" label="Stop" />}
        <ActionButton name={name} action="restart" label="Restart" />
        <ActionButton name={name} action="logout" label="Log out" />
        {status === 'SCAN_QR_CODE' && (
          <button type="button" className="btn btn-sm" onClick={() => setShowQr((v) => !v)}>
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            className="btn btn-sm text-critical"
            disabled={removing}
            onClick={() => {
              if (!confirm(`Remove the "${name}" account? This deletes the WAHA session.`)) return;
              setRemoveError(null);
              const fd = new FormData();
              fd.set('name', name);
              startRemove(async () => {
                const res = await removeSessionAction(fd);
                if (res.error) setRemoveError(res.error);
              });
            }}
          >
            Remove
          </button>
        )}
      </div>
      {removeError && <p className="text-[11px] text-critical">{removeError}</p>}
      {showQr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/whatsapp/accounts/${encodeURIComponent(name)}/qr?t=${Date.now()}`} alt="Scan this QR code with WhatsApp" className="h-48 w-48 rounded-md border border-line" />
      )}
    </div>
  );
}

export function AddAccountForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const fd = new FormData();
          fd.set('name', name);
          start(async () => {
            const res = await addSessionAction(fd);
            if (res.error) setError(res.error);
            else setCreated(name);
          });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">Account name</span>
          <input className="field" placeholder="e.g. clinic_outreach" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending || !name}>
          {pending ? 'Creating…' : 'Create & get QR'}
        </button>
      </form>
      {error && <p className="text-[12px] text-critical">{error}</p>}
      {created && (
        <div className="flex items-center gap-4 rounded-md border border-line p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/whatsapp/accounts/${encodeURIComponent(created)}/qr?t=${Date.now()}`} alt="Scan this QR code with WhatsApp" className="h-48 w-48 rounded-md" />
          <p className="text-[12.5px] text-ink-2">
            Open WhatsApp on the phone you want to connect → Linked devices → Link a device, and scan this code. The page does not refresh automatically; reload it if the
            code expires before you scan it.
          </p>
        </div>
      )}
    </div>
  );
}
