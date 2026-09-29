'use client';

import { AlertTriangle, MessageSquareReply, Table2, XCircle, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';

export interface Point {
  day: string;
  sent: number;
  followups: number;
  replies: number;
  bounces: number;
  failed: number;
}

// Validated with the dataviz palette checker on the #ffffff card surface:
// adjacent CVD ΔE 23.1, normal-vision ΔE 24.0. Aqua is < 3:1 contrast, so a legend
// and a table view are always available (relief rule).
const ORIGINAL = '#2a78d6';
const FOLLOWUP = '#1baf7a';
// Fixed status palette — only used where the color means good / bad.
const STATUS = { replies: '#0ca30c', bounces: '#ec835a', failed: '#d03b3b' };
const GRID = '#e8ebf1';
const AXIS = '#7b8699';

function shortDay(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y, m - 1, day)));
}

function SendTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-ink">{shortDay(String(label))}</div>
      <Row color={ORIGINAL} label="Original emails" value={p.sent} />
      <Row color={FOLLOWUP} label="Follow-ups" value={p.followups} />
      <div className="mt-1 border-t border-line pt-1 text-ink-2">
        Total accepted: <span className="font-semibold text-ink tabular">{p.sent + p.followups}</span>
      </div>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-ink-2">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      <span className="flex-1">{label}</span>
      <span className="font-semibold text-ink tabular">{value}</span>
    </div>
  );
}

function MiniTooltip({ active, payload, label, name }: Partial<TooltipContentProps<number, string>> & { name: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs shadow-md">
      <span className="text-ink-2">{shortDay(String(label))} · </span>
      <span className="font-semibold text-ink tabular">
        {payload[0].value} {name}
      </span>
    </div>
  );
}

function tickInterval(n: number) {
  return n <= 10 ? 0 : n <= 31 ? 4 : Math.ceil(n / 8);
}

export function ActivityCharts({ points, unknownDated }: { points: Point[]; unknownDated: number }) {
  const [table, setTable] = useState(false);
  const totals = points.reduce(
    (a, p) => ({ sent: a.sent + p.sent, followups: a.followups + p.followups, replies: a.replies + p.replies, bounces: a.bounces + p.bounces, failed: a.failed + p.failed }),
    { sent: 0, followups: 0, replies: 0, bounces: 0, failed: 0 },
  );
  const empty = points.every((p) => p.sent + p.followups + p.replies + p.bounces + p.failed === 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ORIGINAL }} aria-hidden /> Original emails
            <b className="tabular text-ink">{totals.sent}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FOLLOWUP }} aria-hidden /> Follow-ups
            <b className="tabular text-ink">{totals.followups}</b>
          </span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
          {table ? 'Chart view' : 'Table view'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Day</th>
                <th className="text-right">Original</th>
                <th className="text-right">Follow-ups</th>
                <th className="text-right">Replies</th>
                <th className="text-right">Bounces</th>
                <th className="text-right">Failed attempts</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td>{shortDay(p.day)}</td>
                  <td className="text-right tabular">{p.sent}</td>
                  <td className="text-right tabular">{p.followups}</td>
                  <td className="text-right tabular">{p.replies}</td>
                  <td className="text-right tabular">{p.bounces}</td>
                  <td className="text-right tabular">{p.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="h-[260px] w-full" role="img" aria-label={`Accepted sends per day: ${totals.sent} original emails and ${totals.followups} follow-ups in this range.`}>
            {empty ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line text-sm text-ink-3">
                No activity recorded in this range yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: '#cfd6e3' }} interval={tickInterval(points.length)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<SendTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                  <Bar dataKey="sent" name="Original emails" stackId="s" fill={ORIGINAL} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
                  <Bar dataKey="followups" name="Follow-ups" stackId="s" fill={FOLLOWUP} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {(
              [
                { key: 'replies', label: 'Replies', total: totals.replies, color: STATUS.replies, Icon: MessageSquareReply, unit: 'replies' },
                { key: 'bounces', label: 'Bounces', total: totals.bounces, color: STATUS.bounces, Icon: AlertTriangle, unit: 'bounces' },
                { key: 'failed', label: 'Failed send attempts', total: totals.failed, color: STATUS.failed, Icon: XCircle, unit: 'failed' },
              ] as const
            ).map(({ key, label, total, color, Icon, unit }) => (
              <div key={key} className="rounded-lg border border-line p-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-ink-2">
                    <Icon size={14} style={{ color }} aria-hidden /> {label}
                  </span>
                  <span className="font-semibold text-ink tabular">{total}</span>
                </div>
                <div className="h-[84px]" role="img" aria-label={`${label}: ${total} in this range`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: -28 }} barCategoryGap="12%">
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="day" hide />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={false} width={36} domain={[0, (max: number) => Math.max(1, max)]} />
                      <Tooltip content={<MiniTooltip name={unit} />} cursor={{ fill: 'rgba(15,23,42,0.05)' }} />
                      <Bar dataKey={key} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {unknownDated > 0 && (
        <p className="mt-3 text-xs text-ink-3">
          {unknownDated} accepted send{unknownDated === 1 ? '' : 's'} in scope {unknownDated === 1 ? 'has' : 'have'} no reliable date (recorded only as a sheet status such as
          &ldquo;FU2 Sent&rdquo;), so {unknownDated === 1 ? 'it is' : 'they are'} counted in campaign totals but not plotted.
        </p>
      )}
    </div>
  );
}
