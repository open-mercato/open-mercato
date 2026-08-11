'use client'

import Link from 'next/link'
import { FileStack, History } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'

export default function DocumentGeneratorsOverviewPage() {
  const t = useT()

  const cards = [
    {
      href: '/backend/document-generators/templates',
      title: t('document_generators.overview.templates.title', 'Available templates'),
      description: t(
        'document_generators.overview.templates.description',
        'Browse built-in and external document templates.',
      ),
      icon: FileStack,
      testId: 'document-generators-templates-link',
    },
    {
      href: '/backend/document-generators/history',
      title: t('document_generators.overview.history.title', 'Generation history'),
      description: t(
        'document_generators.overview.history.description',
        'Browse the document generation history for the current organization.',
      ),
      icon: History,
      testId: 'document-generators-history-link',
    },
  ]

  return (
    <Page data-testid="document-generators-overview-page">
      <PageHeader
        title={t('document_generators.overview.title', 'Document generator')}
        description={t(
          'document_generators.overview.description',
          'Manage available templates and browse the document generation history.',
        )}
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.href}
                href={card.href}
                data-testid={card.testId}
                className="group flex flex-col gap-2 rounded-lg border bg-background p-4 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:shadow-focus"
              >
                <div className="flex items-center gap-3">
                  <Icon aria-hidden="true" className="size-5 text-muted-foreground group-hover:text-accent-foreground" />
                  <h2 className="font-medium">{card.title}</h2>
                </div>
                <p className="text-sm text-muted-foreground group-hover:text-accent-foreground/80">
                  {card.description}
                </p>
              </Link>
            )
          })}
        </div>
      </PageBody>
    </Page>
  )
}
