'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { previewTemplateAction, saveTemplate, uploadWaMedia } from '@/app/actions/whatsapp';
import type { WaTemplate } from '@/lib/whatsapp/templates';

type MediaKind = 'image' | 'document' | 'video';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,text/plain,text/csv';

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

export function TemplateEditor({
  template,
  sampleFields,
  placeholders,
}: {
  template: WaTemplate | null;
  /** Curated aliases plus a real lead's actual sheet columns — whatever the preview can use right now. */
  sampleFields: Record<string, string | null>;
  /** Every placeholder name known across your WhatsApp sheets, shown as hints even if the current
   *  sample lead happens to be missing one. */
  placeholders: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(template?.name ?? '');
  const [bodyText, setBodyText] = useState(template?.bodyText ?? '');
  const [mediaKind, setMediaKind] = useState<MediaKind>(template?.kind && template.kind !== 'text' ? template.kind : 'image');
  const [mediaUrl, setMediaUrl] = useState(template?.mediaUrl ?? '');
  const [mediaId, setMediaId] = useState(template?.mediaId ?? '');
  const [mediaLabel, setMediaLabel] = useState(template?.mediaFilename ?? '');
  const [useUrlInstead, setUseUrlInstead] = useState(!!template?.mediaUrl && !template?.mediaId);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const hasAttachment = !!mediaId || !!mediaUrl;

  const fieldKeys = useMemo(() => {
    const keys = new Set([...Object.keys(sampleFields), ...placeholders]);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [sampleFields, placeholders]);
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries(fieldKeys.map((k) => [k, sampleFields[k] ?? ''])));
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
    const kind = kindFromMime(file.type);
    setUploading(true);
    setSaveError(null);
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('file', file);
    const res = await uploadWaMedia(fd);
    setUploading(false);
    if (res.error) setSaveError(res.error);
    else if (res.mediaId) {
      setMediaKind(kind);
      setMediaId(res.mediaId);
      setMediaLabel(file.name);
      setMediaUrl('');
    }
  }

  function removeAttachment() {
    setMediaId('');
    setMediaUrl('');
    setMediaLabel('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function save() {
    setSaveError(null);
    if (useUrlInstead && mediaUrl && !name) return;
    const fd = new FormData();
    if (template) fd.set('id', String(template.id));
    fd.set('name', name);
    fd.set('kind', hasAttachment ? mediaKind : 'text');
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
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Message</span>
          <textarea className="field w-full resize-y" rows={5} maxLength={4096} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
          <span className="mt-1 block text-[11px] text-ink-3">
            Use <code>{'{{'}</code>column name<code>{'}}'}</code> for anything in your sheet — e.g. <code>{'{{Name}}'}</code> or <code>{'{{Mobile Number}}'}</code>, exactly as
            the column header reads (not case-sensitive). A lead missing that column shows the placeholder as-is in the preview below, never blank or guessed.
          </span>
          {placeholders.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {placeholders.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2 hover:bg-slate-200"
                  onClick={() => setBodyText((t) => `${t}{{${p}}}`)}
                  title={`Insert {{${p}}}`}
                >
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
          )}
        </label>

        <div className="space-y-2 rounded-md border border-dashed border-line-strong p-3">
          <p className="text-[12px] font-medium text-ink-2">Attachment (optional)</p>
          <p className="text-[11px] text-ink-3">Sent with the message as an image, document or video — whatever WAHA accepts for that file type.</p>
          {!hasAttachment || mediaId ? (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} className="text-[12px]" />
              {uploading && <span className="text-[12px] text-ink-3">Uploading…</span>}
            </div>
          ) : null}
          {mediaLabel && (
            <p className="flex items-center gap-2 text-[12px] text-good-text">
              {mediaLabel} ({mediaKind})
              <button type="button" className="link text-[11px]" onClick={removeAttachment}>
                Remove
              </button>
            </p>
          )}
          {!mediaId && (
            <>
              <button type="button" className="link text-[11px]" onClick={() => setUseUrlInstead((v) => !v)}>
                {useUrlInstead ? 'Upload a file instead' : "…or link a file you already host"}
              </button>
              {useUrlInstead && (
                <div className="flex flex-wrap items-center gap-2">
                  <select className="field py-1 text-[12.5px]" value={mediaKind} onChange={(e) => setMediaKind(e.target.value as MediaKind)}>
                    <option value="image">Image</option>
                    <option value="document">Document</option>
                    <option value="video">Video</option>
                  </select>
                  <input className="field flex-1" placeholder="https://…" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                </div>
              )}
            </>
          )}
        </div>

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
        <p className="mb-2 text-[12px] font-medium text-ink-2">
          Preview{Object.keys(sampleFields).length > 1 ? ' — using a real lead, editable below' : ' — no WhatsApp leads loaded yet, so these are blank'}
        </p>
        {fieldKeys.length > 0 && (
          <div className="mb-3 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {fieldKeys.map((k) => (
              <label key={k} className="block">
                <span className="mb-0.5 block truncate text-[10.5px] uppercase tracking-wide text-ink-3" title={k}>
                  {k}
                </span>
                <input className="field w-full py-1 text-[12.5px]" value={fields[k] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
        )}
        <div className="rounded-lg bg-slate-100 p-3">
          {hasAttachment && <div className="mb-2 rounded-md bg-slate-200 px-2 py-6 text-center text-[11px] text-ink-3">{mediaLabel || mediaUrl} ({mediaKind})</div>}
          <p className="whitespace-pre-wrap text-[13px]">{preview?.text || <span className="text-ink-3">Nothing to preview yet</span>}</p>
        </div>
        {!!preview?.missing.length && (
          <p className="mt-2 text-[12px] text-warn">
            Missing for this sample: {preview.missing.map((m) => `{{${m}}}`).join(', ')} — a real lead without this field would see the placeholder left in place.
          </p>
        )}
        {!!preview?.unknown.length && (
          <p className="mt-2 text-[12px] text-critical">
            Not a column found in your WhatsApp sheets, so it can never be filled: {preview.unknown.map((m) => `{{${m}}}`).join(', ')}. Check the spelling against the
            column headers above.
          </p>
        )}
      </div>
    </div>
  );
}
