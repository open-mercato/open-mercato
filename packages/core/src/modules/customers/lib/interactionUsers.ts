import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type InteractionUserScope = {
  tenantId?: string | null
  organizationId?: string | null
}

type InteractionUserReferences = {
  authorUserId?: string | null
  ownerUserId?: string | null
}

type AuthorProfile = { name: string | null; email: string | null }

export function interactionUserKey(scope: InteractionUserScope, userId: string): string {
  return `${scope.tenantId ?? ''}:${scope.organizationId ?? ''}:${userId}`
}

export async function findInteractionUserInScope(
  em: EntityManager,
  userId: string,
  scope: InteractionUserScope,
  options: { includeDeleted?: boolean } = {},
): Promise<User | null> {
  if (!scope.tenantId || !scope.organizationId) return null
  return findOneWithDecryption(em, User, {
    id: userId,
    tenantId: scope.tenantId,
    ...(options.includeDeleted ? {} : { deletedAt: null }),
  }, undefined, scope)
}

export async function requireInteractionUsersInScope(
  em: EntityManager,
  scope: InteractionUserScope,
  references: InteractionUserReferences,
  previousReferences: InteractionUserReferences = {},
): Promise<void> {
  for (const field of ['authorUserId', 'ownerUserId'] as const) {
    const userId = references[field]
    if (!userId) continue
    if (await findInteractionUserInScope(em, userId, scope, { includeDeleted: userId === previousReferences[field] })) continue
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(400, { error: translate('auth.users.form.errors.notFound', 'User not found') })
  }
}

export async function loadInteractionAuthors(
  em: EntityManager,
  references: Array<InteractionUserScope & { authorUserId?: string | null }>,
): Promise<Map<string, AuthorProfile>> {
  const groups = new Map<string, { tenantId: string; organizationId: string; userIds: Set<string> }>()
  for (const reference of references) {
    if (!reference.tenantId || !reference.organizationId || !reference.authorUserId) continue
    const key = interactionUserKey(reference, '')
    let group = groups.get(key)
    if (!group) {
      group = { tenantId: reference.tenantId, organizationId: reference.organizationId, userIds: new Set() }
      groups.set(key, group)
    }
    group.userIds.add(reference.authorUserId)
  }
  const profiles = new Map<string, AuthorProfile>()
  await Promise.all(Array.from(groups.values(), async ({ tenantId, organizationId, userIds }) => {
    const scope = { tenantId, organizationId }
    const users = await findWithDecryption(em, User, {
      id: { $in: Array.from(userIds) },
      tenantId,
    }, undefined, scope)
    for (const user of users) {
      profiles.set(interactionUserKey(scope, user.id), { name: user.name ?? null, email: user.email ?? null })
    }
  }))
  return profiles
}
