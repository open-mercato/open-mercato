import type { EntityData, RequiredEntityData } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SsoIdentity, SsoRoleGrant, SsoUserDeactivation } from '../data/entities'

export const metadata = {
  event: 'privacy.subject.anonymized',
  persistent: true,
  id: 'sso:user-anonymized-cleanup',
}

type SubjectAnonymizedPayload = {
  subjectKind: string
  subjectId: string
  tenantId: string
  organizationId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: SubjectAnonymizedPayload, ctx: ResolverContext) {
  if (payload.subjectKind !== 'auth:user') return
  const em = ctx.resolve<EntityManager>('em')
  await em.transactional(async (transactionalEm) => {
    const identities = await transactionalEm.find(SsoIdentity, {
      userId: payload.subjectId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      deletedAt: null,
    })
    for (const identity of identities) {
      const existing = await transactionalEm.findOne(SsoUserDeactivation, {
        userId: payload.subjectId,
        ssoConfigId: identity.ssoConfigId,
      })
      if (existing) {
        existing.deactivatedAt = new Date()
        existing.reactivatedAt = null
      } else {
        transactionalEm.persist(transactionalEm.create(SsoUserDeactivation, {
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
          userId: payload.subjectId,
          ssoConfigId: identity.ssoConfigId,
          deactivatedAt: new Date(),
        } as RequiredEntityData<SsoUserDeactivation>))
      }
    }
    await transactionalEm.nativeUpdate(
      SsoIdentity,
      {
        userId: payload.subjectId,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
        deletedAt: null,
      },
      { deletedAt: new Date() } as EntityData<SsoIdentity>,
    )
    await transactionalEm.nativeDelete(SsoRoleGrant, {
      userId: payload.subjectId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    })
    await transactionalEm.flush()
  })
}
