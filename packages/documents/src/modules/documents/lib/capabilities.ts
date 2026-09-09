import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { hasTier, type DocumentTier } from './permissions'

export type DocumentCapabilities = {
  canView: boolean
  canComment: boolean
  canEdit: boolean
  canShare: boolean
  canDelete: boolean
  canCreate: boolean
  canManageTemplates: boolean
  canArchive: boolean
  canDuplicate: boolean
}

export type DeriveDocumentCapabilitiesInput = {
  relationshipTier: DocumentTier | null
  managerOverride?: boolean
  archived?: boolean
  userFeatures: readonly string[]
}

function hasFeature(userFeatures: readonly string[], feature: string): boolean {
  return hasAllFeatures([feature], Array.from(userFeatures))
}

export function hasDocumentsManagerOverride(userFeatures: readonly string[]): boolean {
  return hasFeature(userFeatures, 'documents.manage')
}

export function deriveDocumentCapabilities(
  input: DeriveDocumentCapabilitiesInput,
): DocumentCapabilities {
  const managerOverride = input.managerOverride === true
    && hasDocumentsManagerOverride(input.userFeatures)
  const hasRelationship = input.relationshipTier !== null || managerOverride
  const canCommentByTier = managerOverride
    || hasTier(input.relationshipTier, 'commenter')
  const canEditByTier = managerOverride
    || hasTier(input.relationshipTier, 'editor')
  const canOwnByTier = managerOverride || input.relationshipTier === 'owner'
  const archived = input.archived === true

  return {
    canView: hasRelationship && hasFeature(input.userFeatures, 'documents.view'),
    canComment: !archived && canCommentByTier && hasFeature(input.userFeatures, 'documents.view'),
    canEdit: !archived && canEditByTier && hasFeature(input.userFeatures, 'documents.edit'),
    canShare: !archived && canOwnByTier && hasFeature(input.userFeatures, 'documents.share'),
    canDelete: canOwnByTier && hasFeature(input.userFeatures, 'documents.delete'),
    canCreate: hasFeature(input.userFeatures, 'documents.create'),
    canManageTemplates: hasFeature(input.userFeatures, 'documents.templates.manage'),
    canArchive: canOwnByTier && hasFeature(input.userFeatures, 'documents.edit'),
    canDuplicate: hasRelationship
      && hasFeature(input.userFeatures, 'documents.create')
      && hasFeature(input.userFeatures, 'documents.edit'),
  }
}
