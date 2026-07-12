export type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

export function resolveCommentsCapability(
  canComment: boolean | undefined,
  tier: DocumentTier | undefined,
): boolean {
  if (canComment !== undefined) return canComment
  return tier === 'commenter' || tier === 'editor' || tier === 'owner'
}

export function resolveVersionRestoreCapability(
  canRestore: boolean | undefined,
  tier: DocumentTier | undefined,
): boolean {
  if (canRestore !== undefined) return canRestore
  return tier === 'editor' || tier === 'owner'
}
