import { DocumentPageClient } from './DocumentPageClient'

export default async function DocumentEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DocumentPageClient documentId={id} />
}
