import { ReviewPlaybookDetailClient } from '../ReviewPlaybookDetailClient'

export default async function DocumentReviewPlaybookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReviewPlaybookDetailClient playbookId={id} />
}
