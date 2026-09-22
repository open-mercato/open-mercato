"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateRow } from '../components/templateUi'
import { TemplatesTable } from './TemplatesTable'
import { useTemplatesPage } from './useTemplatesPage'

function TemplateEditorDialogLoading({ error, retry }: { error?: Error | null; retry?: () => void }) {
  const t = useT()
  // `next/dynamic` never forwards the caller's `onOpenChange` to a loading
  // shell, so own the dismissal here. Without it a chunk that fails for good
  // (a deploy invalidated it) traps the user in a modal Escape cannot close.
  const [open, setOpen] = React.useState(true)
  if (!open) return null
  return (
    <Dialog open onOpenChange={(next) => { if (!next) setOpen(false) }}>
      <DialogContent size="xl" dismissible={Boolean(error)}>
        <DialogHeader>
          <DialogTitle>{t('documents.templates.actions.manage')}</DialogTitle>
          <DialogDescription>{t('documents.templates.preview.loading')}</DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorMessage
            label={t('documents.templates.error.load')}
            action={<Button type="button" size="sm" variant="outline" onClick={retry}>{t('documents.actions.retry')}</Button>}
          />
        ) : (
          <div role="status" aria-live="polite"><LoadingMessage label={t('documents.templates.preview.loading')} /></div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const TemplateEditorDialog = dynamic(
  () => import('../components/TemplateEditorDialog').then((module) => module.TemplateEditorDialog),
  { ssr: false, loading: TemplateEditorDialogLoading },
)

export function TemplatesPageClient() {
  const t = useT()
  const templates = useTemplatesPage()
  const [editing, setEditing] = React.useState<TemplateRow | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const openEditor = React.useCallback((template: TemplateRow | null) => {
    setEditing(template)
    setEditorOpen(true)
  }, [])
  return (
    <Page>
      <PageBody>
        {templates.loadError ? (
          <ErrorMessage
            label={templates.loadError}
            action={<Button type="button" size="sm" variant="outline" onClick={templates.refresh}>{t('documents.actions.retry')}</Button>}
          />
        ) : (
          <TemplatesTable
          rows={templates.rows}
          page={templates.page}
          pageSize={templates.pageSize}
          total={templates.total}
          totalPages={templates.totalPages}
          totalIsCapped={templates.totalIsCapped}
          search={templates.search}
          isLoading={templates.isLoading}
          canManageTemplates={templates.canManageTemplates}
          onSearchChange={templates.setSearch}
          onPageChange={templates.setPage}
          onPageSizeChange={templates.setPageSize}
          onRefresh={templates.refresh}
          onEdit={openEditor}
          onDelete={(template) => void templates.deleteTemplate(template)}
          />
        )}
        {templates.canManageTemplates && editorOpen ? <TemplateEditorDialog
          open
          template={editing}
          onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditing(null) }}
          onSaved={templates.refreshFromFirstPage}
        /> : null}
        {templates.ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default TemplatesPageClient
