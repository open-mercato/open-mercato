import {
  canWriteToFolder,
  normalizeCollectionCapabilities,
  type FolderRow,
} from '../backend/documents/documentsListTypes'
import { resolveRelatedDocumentActions } from '../widgets/injection/related-documents/context'

describe('document collection capability presentation', () => {
  it('keeps empty-list action capabilities independent from document rows', () => {
    expect(normalizeCollectionCapabilities({
      items: [],
      collectionCapabilities: {
        canCreateDocument: true,
        canCreateFolder: false,
        canLinkDocuments: false,
        canInstantiateTemplate: true,
        canManageTemplates: false,
      },
    })).toEqual({
      canCreateDocument: true,
      canCreateFolder: false,
      canLinkDocuments: false,
      canInstantiateTemplate: true,
      canManageTemplates: false,
    })
  })

  it('fails closed when the projection is absent', () => {
    expect(normalizeCollectionCapabilities({ items: [] })).toEqual({
      canCreateDocument: false,
      canCreateFolder: false,
      canLinkDocuments: false,
      canInstantiateTemplate: false,
      canManageTemplates: false,
    })
  })

  it('allows root but blocks a shared or ancestor-only destination', () => {
    const folder = { canEdit: false } as FolderRow
    expect(canWriteToFolder(null, null)).toBe(true)
    expect(canWriteToFolder('shared-folder', folder)).toBe(false)
    expect(canWriteToFolder('stale-folder', null)).toBe(false)
  })

  it('gates related-record widget actions from collection capabilities', () => {
    const viewOnly = normalizeCollectionCapabilities({ collectionCapabilities: {} })
    expect(resolveRelatedDocumentActions(viewOnly, false)).toEqual({ canLink: false, canCreate: false })
    const editor = normalizeCollectionCapabilities({ collectionCapabilities: { canLinkDocuments: true, canInstantiateTemplate: true } })
    expect(resolveRelatedDocumentActions(editor, false)).toEqual({ canLink: true, canCreate: true })
    expect(resolveRelatedDocumentActions(editor, true)).toEqual({ canLink: false, canCreate: false })
  })
})
