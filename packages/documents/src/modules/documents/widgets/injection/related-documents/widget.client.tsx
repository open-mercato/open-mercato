"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ExternalLink, FilePlus2, Link2 } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../backend/documents/documentUi'
import { LinkDocumentDialog } from './LinkDocumentDialog'
import { resolveRelatedDocumentActions, resolveRelatedDocumentContext } from './context'
import { useRelatedDocuments } from './useRelatedDocuments'

const NewFromTemplateDialog = dynamic(
  () => import('../../../backend/documents/components/NewFromTemplateDialog').then((module) => module.NewFromTemplateDialog),
  { ssr: false, loading: () => null },
)

export default function RelatedDocumentsWidget({ context, data, disabled }: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const target = React.useMemo(() => resolveRelatedDocumentContext(context, data), [context, data])
  const related = useRelatedDocuments(target)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  if (!target || related.status === 'hidden') return null
  const label = target.label ?? t('documents.relatedDocuments.recordFallback')
  const actions = resolveRelatedDocumentActions(related.capabilities, Boolean(disabled))

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader
        title={t('documents.relatedDocuments.title')}
        count={related.items.length}
        action={actions.canLink || actions.canCreate ? <>
          {actions.canLink ? <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Link2 />{t('documents.relatedDocuments.actions.link')}</Button> : null}
          {actions.canCreate ? <Button type="button" size="sm" onClick={() => setCreateOpen(true)}><FilePlus2 />{t('documents.relatedDocuments.actions.create')}</Button> : null}
        </> : undefined}
      />
      <div className="mt-4">
        {related.status === 'loading' ? <LoadingMessage label={t('documents.relatedDocuments.loading')} /> : null}
        {related.status === 'error' ? <ErrorMessage label={t('documents.relatedDocuments.error.load')} action={<Button type="button" size="sm" variant="outline" onClick={related.retry}>{t('documents.actions.retry')}</Button>} /> : null}
        {related.status === 'ready' && related.items.length === 0 ? <EmptyState size="sm" variant="subtle" title={t('documents.relatedDocuments.empty')} icon={<Link2 className="size-5" />} /> : null}
        {related.status === 'ready' && related.items.length > 0 ? <div className="space-y-2">{related.items.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0"><Link className="block truncate text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none" href={`/backend/documents/${row.id}`}>{row.title}</Link><p className="truncate text-xs text-muted-foreground">{t('documents.relatedDocuments.meta', { owner: row.ownerLabel, updated: formatDateTime(row.updatedAt, t('documents.relatedDocuments.unknownDate')) })}</p></div>
            <Button asChild type="button" size="sm" variant="ghost"><Link href={`/backend/documents/${row.id}`}><ExternalLink />{t('documents.actions.open')}</Link></Button>
          </div>
        ))}</div> : null}
      </div>
      {actions.canLink && linkOpen ? <LinkDocumentDialog open target={{ ...target, label }} onOpenChange={setLinkOpen} onLinked={related.retry} /> : null}
      {actions.canCreate && createOpen ? <NewFromTemplateDialog open onOpenChange={setCreateOpen} presetContext={{ entityType: target.entityType, entityId: target.entityId, label, values: target.values }} /> : null}
    </section>
  )
}
