'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { previewTemplateAction, saveTemplate, uploadWaMedia } from '@/app/actions/whatsapp';
import type { TemplateField, WaTemplate } from '@/lib/whatsapp/templates';

const FIELD_HINTS: { field: TemplateField; example: string }[] = [
  { field: 'firstName', example: 'Priya' },
  { field: 'name', example: 'Priya Sharma' },
  { field: 'business', example: 'Priya Sharma' },
  { field: 'city', example: 'Delhi' },
  { field: 'category', example: 'Dental clinic' },
  { field: 'phone', example: '+91 98765 43210' },
];

export function TemplateEditor({ template, sample }: { template: WaTemplate | null; sample: Partial<Record<TemplateField, string | null>> }) {
  const router = useRouter();
  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<'text' | 'image' | 'document' | 'video'>(template?.kind ?? 'text');
  const [bodyText, setBodyText] = useState(template?.bodyText ?? '');
  const [mediaUrl, setMediaUrl] = useState(template?.mediaUrl ?? '');
  const [mediaId, setMediaId] = useState(template?.mediaId ?? '');
  const [mediaLabel, setMediaLabel] = useState(template?.mediaFilename ?? '');
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries(FIELD_HINTS.map((f) => [f.field, sample[f.field] ?? f.example])));
  const [preview, setPreview] = useState<{ text: string; missing: string[]; unknown: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fd = new FormData();
    fd.set('bodyText', bodyText);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const t = setTimeout(() => {
      void previewTemplateAction(fd).then(setPreview);
    }, 150);
    return () => clearTimeout(t);
  }, [bodyText, fields]);

  async function handleUpload(file: File) {
    if (kind === 'text') return;
    setUploading(true);
    setSaveError(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('file', file);
    const res = await uploadWaMedia(fd);
    setUploading(false);
    if (res.error) setSaveError(res.error);
    else if (res.mediaId) {
      setMediaId(res.mediaId);
      setMediaLabel(file.name);
      setMediaUrl('');
    }
  }

  function save() {
    setSaveError(null);
    const fd = new FormData();
    if (template) fd.set('id', String(template.id));
    fd.set('name', name);
    fd.set('kind', kind);
    fd.set('bodyText', bodyText);
    fd.set('mediaUrl', mediaUrl);
    fd.set('mediaId', mediaId);
    startSave(async () => {
      const res = await saveTemplate(fd);
      if (res.error) setSaveError(res.error);
      else router.push('/whatsapp/templates');
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Template name</span>
          <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Message type</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="text">Text only</option>
            <option value="image">Image + caption</option>
            <option value="document">Document + caption</option>
            <option value="video">Video + caption</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">{kind === 'text' ? 'Message' : 'Caption'}</span>
          <textarea className="field w-full resize-y" rows={5} maxLength={4096} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
          <span className="mt-1 block text-[11px] text-ink-3">
            Placeholders: {FIELD_HINTS.map((f) => `{{${f.field}}}`).join('  ')}. A placeholder with no value for a lead is shown as-is in the preview, never sent blank or guessed.
          </span>
        </label>
        {kind !== 'text' && (
          <div className="space-y-2 rounded-md border border-dashed border-line-strong p-3">
            <p className="text-[12px] font-medium text-ink-2">Media</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={kind === 'image' ? 'image/jpeg,image/png,image/webp' : kind === 'video' ? 'video/mp4,video/3gpp' : undefined}
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
                className="text-[12px]"
              />
              {uploading && <span className="text-[12px] text-ink-3">Uploading…</span>}
            </div>
            {mediaLabel && <p className="text-[12px] text-good-text">Using uploaded file: {mediaLabel}</p>}
            <p className="text-[11px] text-ink-3">— or, instead of uploading, link a file you already host —</p>
            <input
              className="field w-full"
              placeholder="https://…"
              value={mediaUrl}
              onChange={(e) => {
                setMediaUrl(e.target.value);
                if (e.target.value) {
                  setMediaId('');
                  setMediaLabel('');
                }
              }}
            />
          </div>
        )}
        {saveError && <p className="text-[12.5px] text-critical">{saveError}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" disabled={saving || !name || !bodyText} onClick={save}>
            {saving ? 'Saving…' : template ? 'Save changes' : 'Create template'}
          </button>
          <button type="button" className="btn" onClick={() => router.push('/whatsapp/templates')}>
            Cancel
          </button>
        </div>
      </div>

      <div className="card p-4">
        <p className="mb-2 text-[12px] font-medium text-ink-2">Preview with sample lead data — edit these to check other cases</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {FIELD_HINTS.map((f) => (
            <label key={f.field} className="block">
              <span className="mb-0.5 block text-[10.5px] uppercase tracking-wide text-ink-3">{f.field}</span>
              <input className="field w-full py-1 text-[12.5px]" value={fields[f.field] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [f.field]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="rounded-lg bg-slate-100 p-3">
          {kind !== 'text' && <div className="mb-2 rounded-md bg-slate-200 px-2 py-6 text-center text-[11px] text-ink-3">{mediaLabel || mediaUrl || 'No media yet'} ({kind})</div>}
          <p className="whitespace-pre-wrap text-[13px]">{preview?.text || <span className="text-ink-3">Nothing to preview yet</span>}</p>
        </div>
        {!!preview?.missing.length && (
          <p className="mt-2 text-[12px] text-warn">Missing for this sample: {preview.missing.map((m) => `{{${m}}}`).join(', ')} — a real lead without this field would see the placeholder left in place.</p>
        )}
        {!!preview?.unknown.length && <p className="mt-2 text-[12px] text-critical">Unknown placeholder(s), will never be filled: {preview.unknown.map((m) => `{{${m}}}`).join(', ')}</p>}
      </div>
    </div>
  );
}
