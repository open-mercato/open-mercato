'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight, Construction } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { logisticsSections, type LogisticsSectionId } from '../lib/sections'

export function LogisticsPageHeader({ section }: { section: LogisticsSectionId }) {
  const t = useT()
  const isDashboard = section === 'dashboard'

  return (
      <PageHeader
        title={t(`logistics.${section}.title`)}
        description={t(`logistics.${section}.description`)}
        actions={isDashboard ? undefined : (
          <LinkButton asChild>
            <Link href="/backend/logistics">
              <ArrowLeft aria-hidden="true" />
              {t('logistics.back')}
            </Link>
          </LinkButton>
        )}
      />
  )
}

export function LogisticsPageContent({ section }: { section: LogisticsSectionId }) {
  const t = useT()

  return (
    <>
        <EmptyState
          title={t('logistics.planned.title')}
          description={t('logistics.planned.description')}
          icon={<Construction className="size-6" aria-hidden="true" />}
        />
        {section === 'dashboard' ? (
          <nav aria-label={t('logistics.sections.title')}>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {logisticsSections.map((item) => (
                <li key={item.id} className="space-y-2 rounded-lg border border-border p-4">
                  <LinkButton asChild>
                    <Link href={item.href}>
                      {t(item.titleKey)}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </LinkButton>
                  <p className="text-sm text-muted-foreground">{t(item.descriptionKey)}</p>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
    </>
  )
}
