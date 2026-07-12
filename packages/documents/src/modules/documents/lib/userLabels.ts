import { sanitizeDocumentsDisplayLabel } from './displayLabels'
import {
  resolveAuthPrincipalService,
  type DocumentsServiceContainer,
} from './platformServices'

export type UserLabel = { label: string; secondary?: string | null }

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
