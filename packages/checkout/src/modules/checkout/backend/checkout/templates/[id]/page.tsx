import { LinkTemplateForm } from '../../../../components/LinkTemplateForm'

export default async function EditCheckoutTemplatePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await params
  return <LinkTemplateForm mode="template" recordId={resolvedParams.id} />
}
