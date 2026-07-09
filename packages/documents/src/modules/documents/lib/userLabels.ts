import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export type UserLabel = { label: string; secondary?: string | null }

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function resolveUserLabels(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  userIds: string[],
): Promise<Map<string, UserLabel>> {
  const uniqueUserIds = Array.from(
    new Set(userIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  )
  const labels = new Map<string, UserLabel>()
  if (uniqueUserIds.length === 0) return labels

  const users = await findWithDecryption(em, User, {
    id: { $in: uniqueUserIds },
    tenantId: scope.tenantId,
    deletedAt: null,
    $or: [{ organizationId: null }, { organizationId: scope.organizationId }],
  } as FilterQuery<User>)

  for (const user of users) {
    const name = cleanString(user.name)
    const email = cleanString(user.email)
    const label = name ?? email
    if (!label) continue
    labels.set(user.id, { label, secondary: name && email && email !== name ? email : null })
  }

  return labels
}
