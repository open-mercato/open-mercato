import { readArrayPayload, readBoolean, readNumber, readRecord, readString, type DocumentCapabilities } from './documentUi'
import { firstSafeDocumentsDisplayLabel } from '../../lib/displayLabels'

export type DocumentRow = {
  id: string
  title: string
  folderId: string | null
  folderName: string | null
  ownerLabel: string
  sharedWithCount: number
  updatedAt: string | null
  archivedAt: string | null
  isFavorite: boolean
  capabilities: DocumentCapabilities
}

export type FolderRow = {
  id: string
  name: string
  parentFolderId: string | null
  updatedAt: string | null
  canEdit: boolean
  visibility: 'owned' | 'contains-visible' | 'ancestor'
}

export type FolderNode = FolderRow & { children: FolderNode[] }
export type CollectionCapabilities = {
  canCreateDocument: boolean
  canCreateFolder: boolean
  canLinkDocuments: boolean
  canInstantiateTemplate: boolean
  canManageTemplates: boolean
}

export const EMPTY_COLLECTION_CAPABILITIES: CollectionCapabilities = {
  canCreateDocument: false,
  canCreateFolder: false,
  canLinkDocuments: false,
  canInstantiateTemplate: false,
  canManageTemplates: false,
}

function readCapabilities(record: Record<string, unknown>): DocumentCapabilities {
  const capabilities = readRecord(record.capabilities) ?? {}
  return {
    canView: readBoolean(capabilities, 'canView', 'can_view') ?? true,
    canComment: readBoolean(capabilities, 'canComment', 'can_comment') ?? false,
    canEdit: readBoolean(capabilities, 'canEdit', 'can_edit') ?? false,
    canShare: readBoolean(capabilities, 'canShare', 'can_share') ?? false,
    canDelete: readBoolean(capabilities, 'canDelete', 'can_delete') ?? false,
    canCreate: readBoolean(capabilities, 'canCreate', 'can_create') ?? false,
    canManageTemplates: readBoolean(capabilities, 'canManageTemplates', 'can_manage_templates') ?? false,
    canArchive: readBoolean(capabilities, 'canArchive', 'can_archive') ?? false,
    canDuplicate: readBoolean(capabilities, 'canDuplicate', 'can_duplicate') ?? false,
  }
}

export function normalizeFolders(payload: unknown): FolderRow[] {
  return readArrayPayload(payload, 'items', 'data', 'folders').flatMap((value) => {
    const record = readRecord(value)
    const id = record ? readString(record, 'id') : null
    const name = record ? readString(record, 'name') : null
    if (!record || !id || !name) return []
    const visibility = readString(record, 'visibility')
    return [{
      id, name,
      parentFolderId: readString(record, 'parentFolderId', 'parent_folder_id'),
      updatedAt: readString(record, 'updatedAt', 'updated_at'),
      canEdit: readBoolean(record, 'canEdit', 'can_edit') ?? false,
      visibility: visibility === 'contains-visible' || visibility === 'ancestor' ? visibility : 'owned',
    }]
  })
}

export function normalizeDocuments(payload: unknown, folders: FolderRow[], unknownOwner: string): DocumentRow[] {
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]))
  return readArrayPayload(payload, 'items', 'data', 'documents').flatMap((value) => {
    const record = readRecord(value)
    const id = record ? readString(record, 'id') : null
    const title = record ? readString(record, 'title') : null
    if (!record || !id || !title) return []
    const folderId = readString(record, 'folderId', 'folder_id')
    return [{
      id, title, folderId,
      folderName: readString(record, 'folderName', 'folder_name') ?? (folderId ? folderMap.get(folderId)?.name ?? null : null),
      ownerLabel: firstSafeDocumentsDisplayLabel(
        readString(
          record,
          'ownerLabel',
          'owner_label',
          'ownerName',
          'owner_name',
          'ownerEmail',
          'owner_email',
        ),
        unknownOwner,
      ) ?? '',
      sharedWithCount: readNumber(
        record,
        'sharedWithCount',
        'shared_with_count',
        'shareCount',
        'share_count',
      ) ?? 0,
      updatedAt: readString(record, 'updatedAt', 'updated_at'),
      archivedAt: readString(record, 'archivedAt', 'archived_at'),
      isFavorite: readBoolean(record, 'isFavorite', 'is_favorite') ?? false,
      capabilities: readCapabilities(record),
    }]
  })
}

export function normalizeCollectionCapabilities(payload: unknown): CollectionCapabilities {
  const root = readRecord(payload)
  const capabilities = readRecord(root?.collectionCapabilities ?? root?.collection_capabilities)
  if (!capabilities) return EMPTY_COLLECTION_CAPABILITIES
  return {
    canCreateDocument: readBoolean(capabilities, 'canCreateDocument', 'can_create_document') ?? false,
    canCreateFolder: readBoolean(capabilities, 'canCreateFolder', 'can_create_folder') ?? false,
    canLinkDocuments: readBoolean(capabilities, 'canLinkDocuments', 'can_link_documents') ?? false,
    canInstantiateTemplate: readBoolean(capabilities, 'canInstantiateTemplate', 'can_instantiate_template') ?? false,
    canManageTemplates: readBoolean(capabilities, 'canManageTemplates', 'can_manage_templates') ?? false,
  }
}

export function canWriteToFolder(selectedFolderId: string | null, folder: FolderRow | null): boolean {
  return selectedFolderId === null || folder?.canEdit === true
}

export function buildFolderTree(folders: FolderRow[]): FolderNode[] {
  const nodes = new Map(folders.map((folder) => [folder.id, { ...folder, children: [] as FolderNode[] }]))
  const roots: FolderNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentFolderId ? nodes.get(node.parentFolderId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: FolderNode[]) => items
    .sort((first, second) => first.name.localeCompare(
      second.name,
      undefined,
      { sensitivity: 'base' },
    ))
    .forEach((item) => sort(item.children))
  sort(roots)
  return roots
}

export function hasActiveTemplate(payload: unknown): boolean {
  return readArrayPayload(payload, 'items', 'data', 'templates').some((value) => {
    const record = readRecord(value)
    return record ? readBoolean(record, 'isActive', 'is_active') !== false : false
  })
}

export function readCreatedId(payload: unknown): string | null {
  const root = readRecord(payload)
  if (!root) return null
  return readString(root, 'id')
    ?? readString(readRecord(root.document) ?? {}, 'id')
    ?? readString(readRecord(root.item) ?? {}, 'id')
    ?? readString(readRecord(root.data) ?? {}, 'id')
}
