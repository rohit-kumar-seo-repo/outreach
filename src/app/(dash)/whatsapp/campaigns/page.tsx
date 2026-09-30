import Link from 'next/link';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { discardCampaignDraft, pauseCampaign, resumeCampaign } from '@/app/actions/whatsapp';
import { Card, EmptyState, fmt, PageHeader, Pill, RateCell } from '@/components/ui';
import { campaignStats } from '@/lib/metrics/campaigns';
import { listCampaignDrafts } from '@/lib/metrics/whatsapp';
import { formatDate, formatDateTime } from '@/lib/time';

export const metadata = { title: 'WhatsApp campaigns' };

export default async function WaCampaignsPage() {
  const [stats, drafts] = await Promise.all([campaignStats().then((r) => r.filter((c) => c.channel === 'whatsapp')), listCampaignDrafts()]);

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Pause, resume and review every WhatsApp campaign. A pause here stops the next queued sends at the n8n workflow's final send step — see each campaign's page for details."
        actions={
          <Link href="/whatsapp/campaigns/new" className="btn btn-sm btn-primary">
            New campaign
          </Link>
        }
      />
      <Card pad={false}>
        {stats.length === 0 ? (
          <EmptyState title="No WhatsApp campaigns configured" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Account</th>
                  <th>Control</th>
                  <th className="text-right">Accepted</th>
                  <th className="text-right">Replies</th>
                  <th className="text-right">Remaining</th>
                  <th className="text-right">Reply rate</th>
                  <th>Last send</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((c) => {
                  const paused = !!c.controlPausedAt;
                  return (
                    <tr key={c.slug}>
                      <td className="max-w-56">
                        <Link href={`/whatsapp/campaigns/${c.slug}`} className="link font-medium">
                          {c.name}
                        </Link>
                      </td>
                      <td className="text-ink-2">{String(c.config.waSession ?? '—')}</td>
                      <td>
                        {paused ? (
                          <Pill tone="warn" title={c.controlPauseReason ?? undefined}>
                            Paused{c.controlPausedBy ? ` by ${c.controlPausedBy}` : ''}
                          </Pill>
                        ) : (
                          <Pill tone={c.status === 'active' ? 'good' : 'default'}>{c.status === 'active' ? 'Active' : c.status === 'paused' ? 'n8n workflow off' : 'Unknown'}</Pill>
                        )}
                      </td>
                      <td className="text-right tabular">{fmt(c.originalsSent)}</td>
                      <td className="text-right tabular">{fmt(c.repliedLeads)}</td>
                      <td className="text-right tabular">{fmt(c.remaining)}</td>
                      <td className="text-right">
                        <RateCell num={c.repliedLeads} den={c.contacted} />
                      </td>
                      <td className="whitespace-nowrap text-ink-2">{c.lastSendAt ? formatDate(c.lastSendAt) : '—'}</td>
                      <td>
                        {paused ? (
                          <form action={resumeCampaign}>
                            <input type="hidden" name="slug" value={c.slug} />
                            <button type="submit" className="btn btn-sm inline-flex items-center gap-1">
                              <PlayCircle size={14} /> Resume
                            </button>
                          </form>
                        ) : (
                          <form action={pauseCampaign}>
                            <input type="hidden" name="slug" value={c.slug} />
                            <button type="submit" className="btn btn-sm inline-flex items-center gap-1">
                              <PauseCircle size={14} /> Pause
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {drafts.length > 0 && (
        <div className="mt-4">
          <Card
            title="Draft campaign requests"
            subtitle="Saved by the setup wizard. A draft cannot send: campaigns are defined in the app's registry (config/registry.json) so their sheet columns and lead rules are known safely, and each needs a matching n8n sending workflow — turning a draft into a live campaign is a code change, not something this page does by itself."
            pad={false}
          >
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Sheet</th>
                  <th>Account</th>
                  <th>Saved</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td className="text-ink-2">
                      {d.sheetUrl ? (
                        <a href={d.sheetUrl} target="_blank" rel="noreferrer noopener" className="link">
                          {d.sheetTab || 'sheet'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-ink-2">{d.session ?? '—'}</td>
                    <td className="whitespace-nowrap text-ink-2">{formatDateTime(d.createdAt)}</td>
                    <td>
                      <form action={discardCampaignDraft}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="btn btn-sm">
                          Discard
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
