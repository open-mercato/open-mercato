"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShareDialog } from './components/ShareDialog'
import { DocumentsTable } from './DocumentsTable'
import { FolderDialog, type FolderDialogState } from './FolderDialog'
import { FolderTree } from './FolderTree'
import { MoveDocumentDialog } from './MoveDocumentDialog'
import type { DocumentRow } from './documentsListTypes'
import { useDocumentsList } from './useDocumentsList'

const NewFromTemplateDialog = dynamic(
  () => import('./components/NewFromTemplateDialog').then((module) => module.NewFromTemplateDialog),
  { ssr: false, loading: () => null },
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
              search={documents.search}
              page={documents.page}
              pageSize={documents.pageSize}
              total={documents.total}
              totalPages={documents.totalPages}
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
            />
          </div>
        </div>
        <FolderDialog
          state={folderDialog}
          onOpenChange={(open) => { if (!open) setFolderDialog(null) }}
          onSubmit={(name) => {
            if (!folderDialog) return
            void documents.saveFolder(folderDialog.mode === 'rename'
              ? { folder: folderDialog.folder, name }
              : { parentFolderId: folderDialog.parentFolderId, name })
            setFolderDialog(null)
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
