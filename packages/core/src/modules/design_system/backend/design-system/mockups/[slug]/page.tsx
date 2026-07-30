"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { MockupViewer } from '../../../../mockups/components/MockupViewer'

export default function DesignSystemMockupPage({ params }: { params?: { slug?: string } }) {
  const slug = params?.slug
  if (!slug) return null
  return (
    <Page>
      <PageBody>
        <MockupViewer slug={slug} />
      </PageBody>
    </Page>
  )
}
