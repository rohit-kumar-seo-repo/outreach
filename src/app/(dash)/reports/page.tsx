import { Card, PageHeader } from '@/components/ui';
import { addDays, localDate } from '@/lib/time';

export const metadata = { title: 'Reports & exports' };

export default function ReportsPage() {
  const today = localDate();
  const from = addDays(today, -29);
  const exports = [
    ['campaigns', 'Campaign performance', 'One row per campaign: leads, sends, follow-ups by step, replies, rates with numerators and denominators.'],
    ['activity', 'Daily activity', 'One row per day and campaign: originals, follow-ups, replies, bounces, failed attempts.'],
    ['attempts', 'Send attempts', 'Every send attempt with result, server response, n8n workflow/execution id and time quality.'],
    ['replies', 'Replies', 'Every matched reply with lead, campaign, mailbox, match method and your classification.'],
    ['leads', 'Leads', 'Every lead with status, source sheet/row, last contact, last reply and next follow-up.'],
  ];
  return (
    <>
      <PageHeader title="Reports & exports" subtitle="CSV exports of the data behind every dashboard number. Dates are in the dashboard timezone." />
      <Card title="Download CSV">
        <form method="get" action="/api/export/campaigns" className="mb-4 flex flex-wrap items-end gap-2 text-[13px]" id="range">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            From
            <input type="date" name="from" defaultValue={from} className="field" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            To
            <input type="date" name="to" defaultValue={today} className="field" />
          </label>
          <p className="pb-2 text-xs text-ink-3">The range applies to activity, attempts and replies. Campaign and lead exports are all-time.</p>
        </form>
        <ul className="divide-y divide-line">
          {exports.map(([kind, label, help]) => (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="text-[13.5px] font-medium">{label}</div>
                <div className="text-[12px] text-ink-2">{help}</div>
              </div>
              <button form="range" formAction={`/api/export/${kind}`} className="btn">
                Download
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
