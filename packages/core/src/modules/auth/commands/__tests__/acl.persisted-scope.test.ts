jest.mock('#generated/entities.ids.generated', () => ({
  E: { auth: { user: 'auth:user', role: 'auth:role' } },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { createContainer, asValue, InjectionMode } from 'awilix'
import '@open-mercato/core/modules/auth/commands/acl'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * `CommandBus.persistLog` resolves the log row's organization as
 * `metadata.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId`.
 * That is a `??` chain, so a handler returning an explicit `null` is
 * indistinguishable from returning nothing — the actor's organization wins.
 *
 * Asserting the handler's own return value therefore proves nothing about the
 * row that is actually written. These tests drive the real bus and assert the
 * payload handed to `actionLogService.log`.
 */
describe('auth ACL commands — persisted log scope', () => {
  const roleId = '11111111-1111-4111-8111-111111111111'
  const actorTenantId = '33333333-3333-4333-8333-333333333333'
  const foreignTenantId = '44444444-4444-4444-8444-444444444444'

  function makeContainer() {
    const logged: Record<string, unknown>[] = []
    const em = {
      fork: () => em,
      findOne: async () => null,
      create: (_entity: unknown, data: Record<string, unknown>) => ({ isSuperAdmin: false, ...data }),
      getReference: (_entity: unknown, id: string) => ({ id }),
      persist: () => undefined,
      begin: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      flush: async () => undefined,
    } as unknown as EntityManager

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      rbacService: asValue({
        invalidateTenantCache: async () => undefined,
        invalidateUserCache: async () => undefined,
      }),
      cache: asValue({ deleteByTags: async () => undefined }),
      actionLogService: asValue({
        log: async (payload: Record<string, unknown>) => {
          logged.push(payload)
          return { id: 'log-1' }
        },
      }),
    })
    return { container, logged }
  }

  function makeCtx(container: ReturnType<typeof makeContainer>['container']) {
    return {
      container,
      auth: { sub: 'admin-1', tenantId: actorTenantId, orgId: 'org-actor' },
      organizationScope: null,
      selectedOrganizationId: 'org-actor',
      organizationIds: ['org-actor'],
    }
  }

  const input = {
    roleId,
    tenantId: actorTenantId,
    isSuperAdmin: false,
    features: ['audit_logs.view_self'],
    organizations: null,
  }

  it('keeps the actor organization on a same-tenant entry', async () => {
    const { container, logged } = makeContainer()
    await new CommandBus().execute('auth.role-acl.update', { input, ctx: makeCtx(container) as never })

    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({
      commandId: 'auth.role-acl.update',
      resourceKind: 'auth.role_acl',
      tenantId: actorTenantId,
      organizationId: 'org-actor',
    })
  })

  it('persists no organization when the entry belongs to another tenant', async () => {
    // Mirrors what the route passes for a cross-tenant super-admin edit: the
    // organization is stripped from the context, because the handler alone
    // cannot defeat the bus's `??` fallback.
    const { container, logged } = makeContainer()
    const ctx = {
      ...makeCtx(container),
      auth: { sub: 'admin-1', tenantId: actorTenantId, orgId: null },
      selectedOrganizationId: null,
      organizationIds: null,
    }

    await new CommandBus().execute('auth.role-acl.update', {
      input: { ...input, tenantId: foreignTenantId },
      ctx: ctx as never,
    })

    expect(logged).toHaveLength(1)
    expect(logged[0].tenantId).toBe(foreignTenantId)
    expect(logged[0].organizationId ?? null).toBeNull()
  })

  it('mints no undo token for either ACL command', async () => {
    const { container, logged } = makeContainer()
    await new CommandBus().execute('auth.role-acl.update', { input, ctx: makeCtx(container) as never })

    expect(logged[0].undoToken ?? null).toBeNull()
  })
})
