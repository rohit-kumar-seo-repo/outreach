import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { TemplateEditor } from '@/components/whatsapp/TemplateEditor';
import { sampleFields, sampleLead, templateById } from '@/lib/whatsapp/templates';

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [template, lead] = await Promise.all([templateById(Number(id)), sampleLead()]);
  if (!template) notFound();
  return (
    <>
      <PageHeader title={`Edit ${template.name}`} />
      <TemplateEditor template={template} sample={lead ? sampleFields(lead) : {}} />
    </>
  );
}
