'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveCampaignDraft } from '@/app/actions/whatsapp';
import type { WaTemplate } from '@/lib/whatsapp/templates';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CampaignWizard({ templates, sessions }: { templates: WaTemplate[]; sessions: string[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTab, setSheetTab] = useState('');
  const [session, setSession] = useState(sessions[0] ?? '');
  const [templateId, setTemplateId] = useState('');
  const [dailyCap, setDailyCap] = useState('10');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startLocal, setStartLocal] = useState('09:00');
  const [endLocal, setEndLocal] = useState('18:00');
  const [notes, setNotes] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const template = templates.find((t) => String(t.id) === templateId);

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('sheetUrl', sheetUrl);
    fd.set('sheetTab', sheetTab);
    fd.set('session', session);
    fd.set('templateId', templateId);
    fd.set('dailyCap', dailyCap);
    for (const d of days) fd.append('sendDay', String(d));
    fd.set('startLocal', startLocal);
    fd.set('endLocal', endLocal);
    fd.set('notes', notes);
    start(async () => {
      const res = await saveCampaignDraft(fd);
      if (res.error) setError(res.error);
      else router.push('/whatsapp/campaigns');
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="card space-y-2 p-4">
          <h2 className="text-[13px] font-semibold text-ink">1. Name</h2>
          <input className="field w-full" placeholder="e.g. Mumbai Dental Follow-up" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </div>

        <div className="card space-y-2 p-4">
          <h2 className="text-[13px] font-semibold text-ink">2. Spreadsheet</h2>
          <input className="field w-full" placeholder="Google Sheet URL" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <input className="field w-full" placeholder="Tab / sheet name" value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} />
        </div>

        <div className="card space-y-2 p-4">
          <h2 className="text-[13px] font-semibold text-ink">3. WhatsApp account</h2>
          {sessions.length === 0 ? (
            <p className="text-[13px] text-ink-2">
              No connected accounts yet — add one on the <a href="/whatsapp/accounts" className="link">Accounts</a> tab first.
            </p>
          ) : (
            <select className="field w-full" value={session} onChange={(e) => setSession(e.target.value)}>
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="card space-y-2 p-4">
          <h2 className="text-[13px] font-semibold text-ink">4. Message template</h2>
          {templates.length === 0 ? (
            <p className="text-[13px] text-ink-2">
              No templates yet — create one on the <a href="/whatsapp/templates" className="link">Templates</a> tab, or come back to this later.
            </p>
          ) : (
            <select className="field w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose later</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.kind})
                </option>
              ))}
            </select>
          )}
          {template && <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[12.5px] text-ink-2">{template.bodyText}</p>}
        </div>

        <div className="card space-y-3 p-4">
          <h2 className="text-[13px] font-semibold text-ink">5. Volume &amp; schedule</h2>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-2">Your daily limit</span>
            <input type="number" min={1} max={1000} className="field w-32" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={days.includes(i + 1)}
                  onChange={(e) => setDays((prev) => (e.target.checked ? [...prev, i + 1].sort() : prev.filter((x) => x !== i + 1)))}
                />
                {d}
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-2">From</span>
              <input type="time" className="field" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-2">To</span>
              <input type="time" className="field" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="card space-y-2 p-4">
          <h2 className="text-[13px] font-semibold text-ink">6. Notes for whoever builds this</h2>
          <textarea className="field w-full resize-y" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Eligible leads, exclusions, anything the sending workflow needs to know…" />
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="card space-y-3 p-4">
          <h2 className="text-[13px] font-semibold text-ink">7. Review</h2>
          <dl className="space-y-1.5 text-[12.5px]">
            <Row label="Name" value={name || '—'} />
            <Row label="Sheet" value={sheetUrl ? `${sheetTab || 'sheet'} (${sheetUrl})` : '—'} />
            <Row label="Account" value={session || '—'} />
            <Row label="Template" value={template?.name ?? 'Not chosen yet'} />
            <Row label="Daily limit" value={dailyCap || '—'} />
            <Row label="Send window" value={`${days.map((d) => DAY_LABELS[d - 1]).join(', ') || 'no days set'}, ${startLocal}–${endLocal}`} />
          </dl>
          <p className="text-[11.5px] text-ink-3">
            Saving only stores this request. It never starts sending — a draft becomes a live, controllable campaign once its spreadsheet is added to the app's registry and a
            matching n8n sending workflow exists.
          </p>
          {error && <p className="text-[12.5px] text-critical">{error}</p>}
          <button type="button" className="btn btn-primary w-full" disabled={pending || !name} onClick={save}>
            {pending ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
