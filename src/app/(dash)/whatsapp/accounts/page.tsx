import { Card, Notice, PageHeader, Pill } from '@/components/ui';
import { SessionActions, AddAccountForm } from '@/components/whatsapp/SessionControls';
import { wahaConfigured, sessionLiveDetail } from '@/lib/whatsapp/accounts';
import { waAccounts } from '@/lib/metrics/whatsapp';
import { formatPhone } from '@/lib/normalize';
import { relativeTime } from '@/lib/time';

export const metadata = { title: 'WhatsApp accounts' };

export default async function WaAccountsPage() {
  const configured = wahaConfigured();
  const accounts = await waAccounts();
  const live = configured ? await Promise.all(accounts.map((a) => sessionLiveDetail(a.name))) : [];

  return (
    <>
      <PageHeader title="Accounts" subtitle="Every WhatsApp number connected through WAHA, its live status, and which campaigns send from it." />
      {!configured && (
        <div className="mb-4">
          <Notice tone="warn" title="WAHA is not configured">
            Set <code>WAHA_BASE_URL</code> and <code>WAHA_API_KEY</code> on the server to manage accounts here.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a, i) => {
          const detail = live[i];
          return (
            <Card
              key={a.name}
              title={a.name}
              subtitle={a.phone ? formatPhone(a.phone) ?? a.phone : a.pushName ?? undefined}
              actions={<Pill tone={a.status === 'WORKING' ? 'good' : 'critical'}>{a.status ?? 'unknown'}</Pill>}
            >
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-ink-2">Last checked</dt>
                  <dd>{a.lastSyncAt ? relativeTime(a.lastSyncAt) : 'never'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">Engine</dt>
                  <dd>{detail?.engine ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">Inbound webhook</dt>
                  <dd className="text-right">
                    {detail?.error ? (
                      <span className="text-critical">Could not check ({detail.error})</span>
                    ) : detail?.webhooks.length ? (
                      <span title={detail.webhooks.map((w) => w.url).join(', ')}>{detail.webhooks.length} configured</span>
                    ) : (
                      <span className="text-warn">None — inbound messages will not arrive here in real time</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-2">Campaigns</dt>
                  <dd className="text-right">{a.campaigns.length ? a.campaigns.map((c) => c.name).join(', ') : '—'}</dd>
                </div>
              </dl>
              {configured && (
                <div className="mt-3 border-t border-line pt-3">
                  <SessionActions name={a.name} status={a.status} canRemove={a.campaigns.length === 0} />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {configured && (
        <div className="mt-4">
          <Card title="Connect a new account" subtitle="Creates a WAHA session and shows its QR code to scan with WhatsApp on the phone you want to use.">
            <AddAccountForm />
          </Card>
        </div>
      )}
    </>
  );
}
