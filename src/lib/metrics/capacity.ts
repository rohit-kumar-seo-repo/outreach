import { q } from '../db';

export interface CapacityRow {
  key: string;
  name: string;
  kind: string;
  url: string | null;
  campaigns: string[];
  lastSuccessAt: Date | null;
  lastError: string | null;
  columns: string[] | null;
  totalRows: number;
  remaining: number;
  ready: number;
  awaitingApproval: number;
  needsDraft: number;
  queued: number;
  contacted: number;
  contactedVerified: number;
  contactedSheetOnly: number;
  duplicates: number;
  invalid: number;
  excluded: number;
  optedOut: number;
  bounced: number;
  failed: number;
  removedFromSheet: number;
  statusValues: { value: string; n: number }[];
}

/**
 * Per spreadsheet / data table. "Contacted" requires an accepted send event linked to the lead.
 * It is split by where that event came from: verified (n8n execution, push, Sent-folder copy)
 * vs recorded only by the sheet's own status column.
 */
export async function capacity(): Promise<CapacityRow[]> {
  return q<CapacityRow>(
    `select s.key, s.name, s.kind, s.external_url as url, s.last_success_at as "lastSuccessAt", s.last_error as "lastError", s.columns,
       coalesce((select array_agg(distinct c.name) from leads l join campaigns c on c.id = l.campaign_id where l.source_id = s.id), '{}') as campaigns,
       count(l.id) filter (where l.present_in_source)::int as "totalRows",
       count(l.id) filter (where l.present_in_source and l.status in ('ready','queued','awaiting_approval','needs_draft','failed'))::int as remaining,
       count(l.id) filter (where l.present_in_source and l.status = 'ready')::int as ready,
       count(l.id) filter (where l.present_in_source and l.status = 'awaiting_approval')::int as "awaitingApproval",
       count(l.id) filter (where l.present_in_source and l.status = 'needs_draft')::int as "needsDraft",
       count(l.id) filter (where l.present_in_source and l.status = 'queued')::int as queued,
       count(l.id) filter (where l.sends_accepted > 0)::int as contacted,
       count(l.id) filter (where exists (select 1 from send_attempts sa where sa.lead_id = l.id and sa.result = 'accepted' and sa.source <> 'sheet_status'))::int as "contactedVerified",
       count(l.id) filter (where l.sends_accepted > 0 and not exists (select 1 from send_attempts sa where sa.lead_id = l.id and sa.result = 'accepted' and sa.source <> 'sheet_status'))::int as "contactedSheetOnly",
       count(l.id) filter (where l.present_in_source and l.is_duplicate)::int as duplicates,
       count(l.id) filter (where l.present_in_source and l.status = 'invalid')::int as invalid,
       count(l.id) filter (where l.present_in_source and l.status = 'excluded')::int as excluded,
       count(l.id) filter (where l.suppressed)::int as "optedOut",
       count(l.id) filter (where l.bounced_at is not null)::int as bounced,
       count(l.id) filter (where l.present_in_source and l.status = 'failed')::int as failed,
       count(l.id) filter (where not l.present_in_source)::int as "removedFromSheet",
       coalesce((select json_agg(x order by x.n desc) from (
           select coalesce(nullif(l2.sheet_status, ''), '(blank)') as value, count(*)::int as n
             from leads l2 where l2.source_id = s.id and l2.present_in_source
            group by 1 order by 2 desc limit 15) x), '[]') as "statusValues"
     from sources s left join leads l on l.source_id = s.id
    where s.kind in ('google_sheet', 'n8n_data_table', 'ingest') and (s.kind <> 'ingest' or exists (select 1 from leads where source_id = s.id))
    group by s.id
    order by s.kind, s.name`,
  );
}
