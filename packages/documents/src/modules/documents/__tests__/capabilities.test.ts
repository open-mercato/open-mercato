import { deriveDocumentCapabilities } from '../lib/capabilities'

describe('document capability projection', () => {
  it('keeps relationship tier separate from action features', () => {
    expect(deriveDocumentCapabilities({
      relationshipTier: 'owner',
      userFeatures: ['documents.view'],
    })).toEqual({
      canView: true,
      canComment: true,
      canEdit: false,
      canShare: false,
      canDelete: false,
      canCreate: false,
      canManageTemplates: false,
      canArchive: false,
      canDuplicate: false,
    })
  })

  it('does not let documents.manage substitute for action features', () => {
    expect(deriveDocumentCapabilities({
      relationshipTier: null,
      managerOverride: true,
      userFeatures: ['documents.manage', 'documents.view'],
    })).toEqual({
      canView: true,
      canComment: true,
      canEdit: false,
      canShare: false,
      canDelete: false,
      canCreate: false,
      canManageTemplates: false,
      canArchive: false,
      canDuplicate: false,
    })
  })

  it('applies each manager action only with its separate feature', () => {
    expect(deriveDocumentCapabilities({
      relationshipTier: null,
      managerOverride: true,
      userFeatures: [
        'documents.manage',
        'documents.view',
        'documents.edit',
        'documents.share',
        'documents.delete',
      ],
    })).toMatchObject({
      canView: true,
      canComment: true,
      canEdit: true,
      canShare: true,
      canDelete: true,
    })
  })

  it('ignores an unbacked manager override', () => {
    expect(deriveDocumentCapabilities({
      relationshipTier: null,
      managerOverride: true,
      userFeatures: ['documents.view', 'documents.edit', 'documents.share', 'documents.delete'],
    })).toMatchObject({
      canView: false,
      canComment: false,
      canEdit: false,
      canShare: false,
      canDelete: false,
    })
  })

  it('honors wildcard grants without widening the relationship tier', () => {
    expect(deriveDocumentCapabilities({
      relationshipTier: 'commenter',
      userFeatures: ['documents.*'],
    })).toEqual({
      canView: true,
      canComment: true,
      canEdit: false,
      canShare: false,
      canDelete: false,
      canCreate: true,
      canManageTemplates: true,
      canArchive: false,
      canDuplicate: true,
    })
  })
})
