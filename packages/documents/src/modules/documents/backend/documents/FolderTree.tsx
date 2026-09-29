"use client"

import * as React from 'react'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildFolderTree, type FolderNode, type FolderRow } from './documentsListTypes'

type FolderTreeProps = {
  folders: FolderRow[]
  selectedFolderId: string | null
  onSelect: (folderId: string | null) => void
  onCreate: (parentFolderId: string | null) => void
  onRename: (folder: FolderRow) => void
  onDelete: (folder: FolderRow) => void
  canCreateFolder: boolean
}

function FolderNodes({ nodes, selectedFolderId, onSelect, onRename, onDelete }: {
  nodes: FolderNode[]
  selectedFolderId: string | null
  onSelect: (folderId: string) => void
  onRename: (folder: FolderRow) => void
  onDelete: (folder: FolderRow) => void
}) {
  const t = useT()
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.id} className="space-y-1">
          <div className="flex items-center gap-1">
            <Button type="button" aria-current={selectedFolderId === node.id ? 'page' : undefined} variant={selectedFolderId === node.id ? 'secondary' : 'ghost'} className="min-w-0 flex-1 justify-start" onClick={() => onSelect(node.id)}>
              <span className={node.visibility === 'ancestor' ? 'truncate text-muted-foreground' : 'truncate'}>{node.name}</span>
            </Button>
            {node.canEdit ? (
              <RowActions items={[
                { id: 'rename', label: t('documents.folders.actions.rename'), onSelect: () => onRename(node) },
                { id: 'delete', label: t('documents.actions.delete'), destructive: true, onSelect: () => onDelete(node) },
              ]} />
            ) : null}
          </div>
          {node.visibility === 'ancestor' ? <p className="pl-3 text-xs text-muted-foreground">{t('documents.folders.visibility.ancestor')}</p> : null}
          {node.visibility === 'contains-visible' ? <p className="pl-3 text-xs text-muted-foreground">{t('documents.folders.visibility.shared')}</p> : null}
          {node.children.length > 0 ? <div className="ml-4"><FolderNodes nodes={node.children} selectedFolderId={selectedFolderId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} /></div> : null}
        </li>
      ))}
    </ul>
  )
}

export function FolderTree(props: FolderTreeProps) {
  const t = useT()
  const tree = React.useMemo(() => buildFolderTree(props.folders), [props.folders])
  const selected = props.selectedFolderId ? props.folders.find((folder) => folder.id === props.selectedFolderId) : null
  return (
    <aside className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-1 lg:max-h-screen lg:self-start lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('documents.folders.title')}</h2>
        {props.canCreateFolder ? (
          <Button type="button" size="sm" variant="outline" onClick={() => props.onCreate(selected?.canEdit ? selected.id : null)}>
            {t(selected && !selected.canEdit ? 'documents.folders.actions.newAtRoot' : 'documents.folders.actions.new')}
          </Button>
        ) : null}
      </div>
      {props.canCreateFolder && selected && !selected.canEdit ? <p className="text-xs text-muted-foreground">{t('documents.folders.newAtRootHint')}</p> : null}
      <Button type="button" aria-current={props.selectedFolderId === null ? 'page' : undefined} variant={props.selectedFolderId === null ? 'secondary' : 'ghost'} className="w-full justify-start" onClick={() => props.onSelect(null)}>{t('documents.folders.root')}</Button>
      {tree.length > 0 ? (
        <FolderNodes nodes={tree} selectedFolderId={props.selectedFolderId} onSelect={(id) => props.onSelect(id)} onRename={props.onRename} onDelete={props.onDelete} />
      ) : <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">{t('documents.folders.empty')}</p>}
    </aside>
  )
}
