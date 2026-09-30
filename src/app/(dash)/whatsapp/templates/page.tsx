import Link from 'next/link';
import { deleteTemplate } from '@/app/actions/whatsapp';
import { Card, EmptyState, PageHeader, Pill } from '@/components/ui';
import { listTemplates } from '@/lib/whatsapp/templates';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: 'WhatsApp templates' };

export default async function TemplatesPage() {
  const templates = await listTemplates();

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Reusable messages with {{placeholders}} filled from real lead data. Saving a template never sends anything."
        actions={
          <Link href="/whatsapp/templates/new" className="btn btn-primary">
            New template
          </Link>
        }
      />
      <Card pad={false}>
        {templates.length === 0 ? (
          <EmptyState title="No templates yet">Create one to reuse across campaigns.</EmptyState>
        ) : (
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Used by</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-72 truncate">
                    <Link href={`/whatsapp/templates/${t.id}`} className="link font-medium">
                      {t.name}
                    </Link>
                    <div className="truncate text-[11.5px] text-ink-3">{t.bodyText}</div>
                  </td>
                  <td>
                    <Pill tone={t.kind === 'text' ? 'default' : 'brand'}>{t.kind}</Pill>
                  </td>
                  <td className="text-ink-2">{t.usedByCampaigns.length ? t.usedByCampaigns.join(', ') : '—'}</td>
                  <td className="whitespace-nowrap text-ink-2">{formatDateTime(t.updatedAt)}</td>
                  <td>
                    <Link href={`/whatsapp/templates/${t.id}`} className="btn btn-sm">
                      Edit
                    </Link>{' '}
                    {t.usedByCampaigns.length === 0 && (
                      <form action={deleteTemplate} className="inline">
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="btn btn-sm text-critical">
                          Delete
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
