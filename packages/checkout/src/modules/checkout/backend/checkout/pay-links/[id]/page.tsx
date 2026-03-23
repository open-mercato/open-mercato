import { LinkTemplateForm } from '../../../../components/LinkTemplateForm'

export default async function EditCheckoutPayLinkPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await params
  return <LinkTemplateForm mode="link" recordId={resolvedParams.id} />
}
