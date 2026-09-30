import { PageHeader } from '@/components/ui';
import { TemplateEditor } from '@/components/whatsapp/TemplateEditor';
import { sampleFields, sampleLead } from '@/lib/whatsapp/templates';

export const metadata = { title: 'New WhatsApp template' };

export default async function NewTemplatePage() {
  const lead = await sampleLead();
  return (
    <>
      <PageHeader title="New template" subtitle="Preview uses a real lead's data where one exists, so a missing field shows up here before it ever reaches a real send." />
      <TemplateEditor template={null} sample={lead ? sampleFields(lead) : {}} />
    </>
  );
}
