import { sanitizeDocumentsDisplayLabel } from './displayLabels'
import {
  resolveAuthPrincipalService,
  type DocumentsServiceContainer,
} from './platformServices'

export type UserLabel = { label: string; secondary?: string | null }
export type ViewerSafeUserLabel = { label: string }

function cleanString(value: unknown): string | null {
  return sanitizeDocumentsDisplayLabel(value)
}

export async function resolveUserLabels(
  container: DocumentsServiceContainer | null | undefined,
  scope: { tenantId: string; organizationId: string },
  userIds: string[],
): Promise<Map<string, UserLabel>> {
  const uniqueUserIds = Array.from(
    new Set(userIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  )
  const labels = new Map<string, UserLabel>()
  if (uniqueUserIds.length === 0) return labels

  const service = resolveAuthPrincipalService(container)
  if (!service) return labels
  const users = await service.resolveLabels({ type: 'user', ids: uniqueUserIds, scope })

  for (const user of users) {
    const label = cleanString(user.label)
    const secondary = cleanString(user.secondary)
    if (!label) continue
    labels.set(user.id, { label, secondary: secondary && secondary !== label ? secondary : null })
  }

  return labels
}

/**
 * Resolve labels safe for document viewers. Comment history needs readable
 * author names, but it is not a directory surface: secondary identifiers must
 * not cross this boundary. The primary label itself is kept as the directory
 * resolved it — for an account without a display name that is its email, the
 * same label the list owner column and version history already show, so a
 * commenter never degrades to the "unknown user" placeholder.
 */
export async function resolveViewerSafeUserLabels(
  container: DocumentsServiceContainer | null | undefined,
  scope: { tenantId: string; organizationId: string },
  userIds: string[],
): Promise<Map<string, ViewerSafeUserLabel>> {
  const resolved = await resolveUserLabels(container, scope, userIds)
  const labels = new Map<string, ViewerSafeUserLabel>()
  for (const [userId, value] of resolved.entries()) {
    labels.set(userId, { label: value.label })
  }
  return labels
}
