import type { EntityManager } from '@mikro-orm/postgresql'
import { SsoIdentity, SsoRoleGrant, SsoUserDeactivation } from '../data/entities'

export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'sso:user-deleted-cleanup',
}

type UserDeletedPayload = {
  userId: string
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: UserDeletedPayload, ctx: ResolverContext) {
  const em = ctx.resolve<EntityManager>('em')

  await em.nativeUpdate(
    SsoIdentity,
    { userId: payload.userId, deletedAt: null },
    { deletedAt: new Date() } as any,
  )

  await em.nativeDelete(SsoRoleGrant, { userId: payload.userId })

  await em.nativeDelete(SsoUserDeactivation, { userId: payload.userId })
}
