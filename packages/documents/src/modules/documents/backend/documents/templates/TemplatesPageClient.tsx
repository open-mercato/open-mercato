"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { TemplateRow } from '../components/templateUi'
import { TemplatesTable } from './TemplatesTable'
import { useTemplatesPage } from './useTemplatesPage'

const TemplateEditorDialog = dynamic(
  () => import('../components/TemplateEditorDialog').then((module) => module.TemplateEditorDialog),
  { ssr: false, loading: () => null },
)

export function TemplatesPageClient() {
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
        <TemplatesTable
          rows={templates.rows}
          page={templates.page}
          pageSize={templates.pageSize}
          total={templates.total}
          totalPages={templates.totalPages}
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
