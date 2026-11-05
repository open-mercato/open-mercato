import {
  commandActorScope,
  ensureTenantScope,
  ensureOrganizationScope,
  ensureSameScope,
  assertFound,
  extractUndoPayload,
  cloneJson,
  toNumericString,
  requireProduct,
  requireVariant,
  requireOffer,
  requirePriceKind,
  requireOptionSchemaTemplate,
  type RequireScope,
} from '../shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

describe('catalog command shared helpers', () => {
  type AuthOverride = Partial<NonNullable<CommandRuntimeContext['auth']>> | null
  const createCtx = (
    overrides: Partial<Omit<CommandRuntimeContext, 'auth'>> & { auth?: AuthOverride } = {}
  ): CommandRuntimeContext => {
    const baseAuth: NonNullable<CommandRuntimeContext['auth']> = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    }
    const { auth: authOverride, ...rest } = overrides
    const auth =
      authOverride === null
        ? null
        : ({
            ...baseAuth,
            ...(authOverride ?? {}),
          } as NonNullable<CommandRuntimeContext['auth']>)
    return {
      container: { resolve: jest.fn() } as unknown as AwilixContainer,
      auth,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
      ...rest,
    }
  }

  it('enforces tenant scope when conflicting tenant id is provided', () => {
    expect(() => ensureTenantScope(createCtx(), 'tenant-1')).not.toThrow()
    expect(() => ensureTenantScope(createCtx({ auth: { tenantId: null } }), 'tenant-2')).toThrow(CrudHttpError)
    expect(() => ensureTenantScope(createCtx({ auth: null }), 'tenant-2')).not.toThrow()
    expect(() => ensureTenantScope(createCtx(), 'tenant-2')).toThrow(CrudHttpError)
  })

  it('enforces organization scope with either selected org or auth org id', () => {
    expect(() => ensureOrganizationScope(createCtx(), 'org-1')).not.toThrow()
    expect(() => ensureOrganizationScope(createCtx({ selectedOrganizationId: 'org-override' }), 'org-override')).not.toThrow()
    expect(() => ensureOrganizationScope(createCtx(), 'org-2')).toThrow(CrudHttpError)
  })

  it('ensures entities belong to the same tenant + org combo', () => {
    expect(() => ensureSameScope({ organizationId: 'org-1', tenantId: 'tenant-1' }, 'org-1', 'tenant-1')).not.toThrow()
    expect(() => ensureSameScope({ organizationId: 'org-1', tenantId: 'tenant-2' }, 'org-1', 'tenant-1')).toThrow(CrudHttpError)
  })

  it('asserts non-null values', () => {
    expect(assertFound(1, 'missing')).toBe(1)
    expect(() => assertFound(null, 'missing')).toThrow(CrudHttpError)
  })

  it('extracts undo payloads regardless of nesting', () => {
    const basePayload = { foo: 'bar' }
    const direct = { commandPayload: { undo: basePayload } }
    const nested = { commandPayload: { value: { undo: basePayload } } }
    const deepNested = { commandPayload: { anything: { undo: basePayload }, __redoInput: {} } }
    expect(extractUndoPayload(direct)).toEqual(basePayload)
    expect(extractUndoPayload(nested)).toEqual(basePayload)
    expect(extractUndoPayload(deepNested)).toEqual(basePayload)
    expect(extractUndoPayload(null)).toBeNull()
  })

  it('clones JSON-compatible structures defensively', () => {
    const payload = { nested: { value: 1 } }
    const clone = cloneJson(payload)
    expect(clone).toEqual(payload)
    expect(clone).not.toBe(payload)
    ;(clone as { nested: { value: number } }).nested.value = 2
    expect(payload.nested.value).toBe(1)
  })

  it('normalizes numeric values to strings', () => {
    expect(toNumericString(15)).toBe('15')
    expect(toNumericString(null)).toBeNull()
  })

  describe('commandActorScope', () => {
    it('returns the actor tenant and organization for a scoped user', () => {
      expect(commandActorScope(createCtx())).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    })

    it('prefers the explicitly selected organization id', () => {
      expect(commandActorScope(createCtx({ selectedOrganizationId: 'org-9' }))).toEqual({
        tenantId: 'tenant-1',
        organizationId: 'org-9',
      })
    })

    it('leaves the organization unrestricted for super admins', () => {
      expect(commandActorScope(createCtx({ auth: { isSuperAdmin: true } }))).toEqual({
        tenantId: 'tenant-1',
        organizationId: null,
      })
    })

    it('leaves the organization unrestricted for global-org actors', () => {
      const scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-1' } as OrganizationScope
      expect(commandActorScope(createCtx({ organizationScope: scope }))).toEqual({
        tenantId: 'tenant-1',
        organizationId: null,
      })
    })

    // Regression for #7612: a scope-only caller (auth: null, e.g. the Akeneo importer)
    // must still be scoped by tenant via organizationScope.tenantId — the pre-fix
    // implementation dropped tenant scoping entirely whenever auth was null.
    it('falls back to organizationScope.tenantId when auth is null', () => {
      const scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: 'tenant-2' } as OrganizationScope
      expect(commandActorScope(createCtx({ auth: null, organizationScope: scope }))).toEqual({
        tenantId: 'tenant-2',
        organizationId: null,
      })
    })

    // Regression for #7612: a restricted multi-org actor must be scoped to every
    // allowed organization, not pinned to just the currently selected one — the
    // pre-fix implementation 404'd a lookup for a record in another allowed org.
    it('scopes a restricted actor to every allowed organization, not just the selected one', () => {
      const scope = {
        selectedId: 'org-1',
        filterIds: ['org-1'],
        allowedIds: ['org-1', 'org-9'],
        tenantId: 'tenant-1',
      } as OrganizationScope
      expect(
        commandActorScope(createCtx({ selectedOrganizationId: 'org-1', organizationScope: scope }))
      ).toEqual({
        tenantId: 'tenant-1',
        organizationId: ['org-1', 'org-9'],
      })
    })
  })

  // The mock EM behaves like the SQL layer: it only returns the seeded record when the
  // where clause's tenant/org match it. This proves the require* helpers filter by scope
  // (the test fails on the pre-fix unscoped implementation, which returned the row regardless).
  type ScopedEntity = { id: string; tenantId: string; organizationId: string }
  const makeScopedEm = (entity: ScopedEntity) => {
    const findOne = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
      if (where.id !== entity.id) return null
      if (where.tenantId !== undefined && where.tenantId !== entity.tenantId) return null
      if (where.organizationId !== undefined && where.organizationId !== entity.organizationId) return null
      return entity
    })
    return { em: { findOne } as unknown as EntityManager, findOne }
  }

  const sameScope: RequireScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
  const foreignTenantScope: RequireScope = { tenantId: 'tenant-2', organizationId: 'org-1' }

  const scopedHelpers: Array<{ label: string; call: (em: EntityManager, scope: RequireScope) => Promise<unknown> }> = [
    { label: 'requireProduct', call: (em, scope) => requireProduct(em, 'rec', scope) },
    { label: 'requireVariant', call: (em, scope) => requireVariant(em, 'rec', scope) },
    { label: 'requireOffer', call: (em, scope) => requireOffer(em, 'rec', scope) },
    { label: 'requireOptionSchemaTemplate', call: (em, scope) => requireOptionSchemaTemplate(em, 'rec', scope) },
  ]

  for (const { label, call } of scopedHelpers) {
    describe(label, () => {
      const entity: ScopedEntity = { id: 'rec', tenantId: 'tenant-1', organizationId: 'org-1' }

      it('returns the record and scopes the query when tenant/org match', async () => {
        const { em, findOne } = makeScopedEm(entity)
        await expect(call(em, sameScope)).resolves.toBe(entity)
        const where = findOne.mock.calls[0][1] as Record<string, unknown>
        expect(where).toMatchObject({ id: 'rec', tenantId: 'tenant-1', organizationId: 'org-1' })
      })

      it('throws 404 for a cross-tenant id', async () => {
        const { em } = makeScopedEm(entity)
        await expect(call(em, foreignTenantScope)).rejects.toBeInstanceOf(CrudHttpError)
      })

      it('omits the tenant/org filters when scope is null (super-admin lookup)', async () => {
        const { em, findOne } = makeScopedEm(entity)
        await expect(call(em, { tenantId: null, organizationId: null })).resolves.toBe(entity)
        const where = findOne.mock.calls[0][1] as Record<string, unknown>
        expect(where.tenantId).toBeUndefined()
        expect(where.organizationId).toBeUndefined()
      })
    })
  }

  // Regression for #7612: requireOffer (and the other require* helpers) must find a
  // record scoped to any allowed organization, not just the first/selected one, once
  // commandActorScope returns the full allowed set as an array. Mirrors the
  // catalog.offers.delete scenario where `prepare` (commandScopeWhere) found the
  // offer but `execute` (the pre-fix commandActorScope) 404'd on it.
  describe('requireOffer with a multi-organization scope', () => {
    const entity: ScopedEntity = { id: 'rec', tenantId: 'tenant-1', organizationId: 'org-9' }
    const findOne = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
      if (where.id !== entity.id) return null
      if (where.tenantId !== undefined && where.tenantId !== entity.tenantId) return null
      const orgFilter = where.organizationId
      if (orgFilter !== undefined) {
        const allowed = (orgFilter as { $in?: string[] })?.$in
        if (Array.isArray(allowed) ? !allowed.includes(entity.organizationId) : orgFilter !== entity.organizationId) {
          return null
        }
      }
      return entity
    })
    const em = { findOne } as unknown as EntityManager

    it('finds a record in a non-selected-but-allowed organization', async () => {
      const scope: RequireScope = { tenantId: 'tenant-1', organizationId: ['org-1', 'org-9'] }
      await expect(requireOffer(em, 'rec', scope)).resolves.toBe(entity)
      const where = findOne.mock.calls[0][1] as Record<string, unknown>
      expect(where.organizationId).toEqual({ $in: ['org-1', 'org-9'] })
    })

    it('throws 404 when the organization is not in the allowed set', async () => {
      const scope: RequireScope = { tenantId: 'tenant-1', organizationId: ['org-1', 'org-2'] }
      await expect(requireOffer(em, 'rec', scope)).rejects.toBeInstanceOf(CrudHttpError)
    })
  })

  // Price kinds are tenant-global (organization_id is always null, unique key (tenant_id, code)).
  // requirePriceKind must scope by tenant only; applying a caller's concrete org would never match
  // the null row — the regression that returned 404 on price create for an org-scoped product/variant.
  describe('requirePriceKind', () => {
    const tenantGlobalPriceKind = { id: 'pk', tenantId: 'tenant-1', organizationId: null as string | null }
    const makePriceKindEm = () => {
      const findOne = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
        if (where.id !== tenantGlobalPriceKind.id) return null
        if (where.tenantId !== undefined && where.tenantId !== tenantGlobalPriceKind.tenantId) return null
        if (where.organizationId !== undefined && where.organizationId !== tenantGlobalPriceKind.organizationId) return null
        return tenantGlobalPriceKind
      })
      return { em: { findOne } as unknown as EntityManager, findOne }
    }

    it('scopes by tenant only and ignores the caller org (finds the tenant-global row)', async () => {
      const { em, findOne } = makePriceKindEm()
      await expect(requirePriceKind(em, 'pk', sameScope)).resolves.toBe(tenantGlobalPriceKind)
      const where = findOne.mock.calls[0][1] as Record<string, unknown>
      expect(where.tenantId).toBe('tenant-1')
      expect(where.organizationId).toBeUndefined()
    })

    it('throws 404 for a cross-tenant id', async () => {
      const { em } = makePriceKindEm()
      await expect(requirePriceKind(em, 'pk', foreignTenantScope)).rejects.toBeInstanceOf(CrudHttpError)
    })
  })
})
