"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShareDialog } from './components/ShareDialog'
import { DocumentsTable } from './DocumentsTable'
import { FolderDialog, type FolderDialogState } from './FolderDialog'
import { FolderTree } from './FolderTree'
import { MoveDocumentDialog } from './MoveDocumentDialog'
import type { DocumentRow } from './documentsListTypes'
import { useDocumentsList } from './useDocumentsList'

function NewFromTemplateDialogLoading({ error, retry }: { error?: Error | null; retry?: () => void }) {
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
          <DialogTitle>{t('documents.templates.instantiate.title')}</DialogTitle>
          <DialogDescription>{t('documents.templates.instantiate.description')}</DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorMessage
            label={t('documents.templates.instantiate.error.load')}
            action={<Button type="button" size="sm" variant="outline" onClick={retry}>{t('documents.actions.retry')}</Button>}
          />
        ) : (
          <div role="status" aria-live="polite"><LoadingMessage label={t('documents.templates.instantiate.loading')} /></div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const NewFromTemplateDialog = dynamic(
  () => import('./components/NewFromTemplateDialog').then((module) => module.NewFromTemplateDialog),
  { ssr: false, loading: NewFromTemplateDialogLoading },
)

export function DocumentsPageClient() {
  const t = useT()
  const documents = useDocumentsList()
  const [shareDocument, setShareDocument] = React.useState<DocumentRow | null>(null)
  const [templateDialogOpen, setTemplateDialogOpen] = React.useState(false)
  const [folderDialog, setFolderDialog] = React.useState<FolderDialogState | null>(null)
  const [moveDocument, setMoveDocument] = React.useState<DocumentRow | null>(null)
  const selectedFolder = documents.selectedFolderId
    ? documents.folders.find((folder) => folder.id === documents.selectedFolderId) ?? null
    : null
  const destinationWritable = documents.selectedFolderId === null || selectedFolder?.canEdit === true
  const canCreateDocument = documents.collectionCapabilities.canCreateDocument && destinationWritable
  const canInstantiateTemplate = documents.collectionCapabilities.canInstantiateTemplate && destinationWritable

  return (
    <Page>
      <PageBody>
        {documents.loadError ? (
          <ErrorMessage
            label={documents.loadError}
            action={<Button type="button" size="sm" variant="outline" onClick={documents.refresh}>{t('documents.actions.retry')}</Button>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-4">
          <FolderTree
            folders={documents.folders}
            selectedFolderId={documents.selectedFolderId}
            onSelect={(folderId) => { documents.setSelectedFolderId(folderId); documents.setPage(1) }}
            onCreate={(parentFolderId) => setFolderDialog({ mode: 'create', parentFolderId })}
            onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
            onDelete={(folder) => void documents.deleteFolder(folder)}
            canCreateFolder={documents.collectionCapabilities.canCreateFolder}
          />
          <div className="min-w-0 lg:col-span-3">
            <DocumentsTable
              title={selectedFolder?.name ?? t('documents.list.title')}
              rows={documents.rows}
              isLoading={documents.isLoading}
              isCreating={documents.isCreating}
              search={documents.search}
              page={documents.page}
              pageSize={documents.pageSize}
              total={documents.total}
              totalPages={documents.totalPages}
              totalIsCapped={documents.totalIsCapped}
              hasTemplates={documents.hasTemplates}
              canCreateDocument={canCreateDocument}
              canInstantiateTemplate={canInstantiateTemplate}
              canManageTemplates={documents.collectionCapabilities.canManageTemplates}
              onSearchChange={(search) => { documents.setSearch(search); documents.setPage(1) }}
              onPageChange={documents.setPage}
              onPageSizeChange={(pageSize) => { documents.setPageSize(pageSize); documents.setPage(1) }}
              onRefresh={documents.refresh}
              onCreate={() => void documents.createDocument()}
              onNewFromTemplate={() => setTemplateDialogOpen(true)}
              onShare={setShareDocument}
              onMove={setMoveDocument}
              onDelete={(row) => void documents.deleteDocument(row)}
              archivedFilter={documents.archivedFilter}
              favoritesOnly={documents.favoritesOnly}
              onArchivedFilterChange={documents.setArchivedFilter}
              onFavoritesOnlyChange={documents.setFavoritesOnly}
              onToggleFavorite={(row) => void documents.toggleFavorite(row)}
              onDuplicate={(row) => void documents.duplicateDocument(row)}
              onArchiveToggle={(row) => void documents.archiveToggle(row)}
            />
          </div>
          </div>
        )}
        <FolderDialog
          state={folderDialog}
          onOpenChange={(open) => { if (!open) setFolderDialog(null) }}
          onSubmit={(name) => {
            if (!folderDialog) return false
            return documents.saveFolder(folderDialog.mode === 'rename'
              ? { folder: folderDialog.folder, name }
              : { parentFolderId: folderDialog.parentFolderId, name })
          }}
        />
        {shareDocument ? (
          <ShareDialog
            documentId={shareDocument.id}
            open
            onOpenChange={(open) => { if (!open) setShareDocument(null) }}
            canManage={shareDocument.capabilities.canShare}
          />
        ) : null}
        <MoveDocumentDialog
          document={moveDocument}
          folders={documents.folders}
          open={moveDocument !== null}
          onOpenChange={(open) => { if (!open) setMoveDocument(null) }}
          onMove={documents.moveDocument}
        />
        {canInstantiateTemplate && templateDialogOpen ? <NewFromTemplateDialog open folderId={documents.selectedFolderId} onOpenChange={setTemplateDialogOpen} /> : null}
        {documents.ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default DocumentsPageClient
