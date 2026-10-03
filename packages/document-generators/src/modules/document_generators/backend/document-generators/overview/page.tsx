"use client"

import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Card, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const OVERVIEW_LINKS = [
  { id: 'templates', href: '/backend/document-generators/templates' },
  { id: 'history', href: '/backend/document-generators/history' },
] as const

export default function DocumentGeneratorsOverviewPage() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('document_generators.overview.title')}
          description={t('document_generators.overview.description')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {OVERVIEW_LINKS.map((link) => (
            <Link key={link.id} href={link.href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle>{t(`document_generators.overview.${link.id}.title`)}</CardTitle>
                  <CardDescription>{t(`document_generators.overview.${link.id}.description`)}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </PageBody>
    </Page>
  )
}
