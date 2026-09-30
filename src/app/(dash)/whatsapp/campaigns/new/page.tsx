import { PageHeader } from '@/components/ui';
import { CampaignWizard } from '@/components/whatsapp/CampaignWizard';
import { waSessions } from '@/lib/metrics/whatsapp';
import { listTemplates } from '@/lib/whatsapp/templates';

export const metadata = { title: 'New WhatsApp campaign' };

export default async function NewCampaignPage() {
  const [templates, sessions] = await Promise.all([listTemplates(), waSessions()]);
  return (
    <>
      <PageHeader title="New campaign" subtitle="Step through setup, review the exact summary, then save. Nothing sends from this wizard." />
      <CampaignWizard templates={templates} sessions={sessions.map((s) => s.name)} />
    </>
  );
}
