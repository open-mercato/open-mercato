import {
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
  requireOptionSchemaTemplate,
} from '../shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
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
    expect(() => ensureTenantScope(createCtx({ auth: { tenantId: null } }), 'tenant-2')).not.toThrow()
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
    expect(extractUndoPayload(direct as any)).toEqual(basePayload)
    expect(extractUndoPayload(nested as any)).toEqual(basePayload)
    expect(extractUndoPayload(deepNested as any)).toEqual(basePayload)
    expect(extractUndoPayload(null)).toBeNull()
  })

  it('clones JSON-compatible structures defensively', () => {
    const payload = { nested: { value: 1 } }
    const clone = cloneJson(payload)
    expect(clone).toEqual(payload)
    expect(clone).not.toBe(payload)
    ;(clone as any).nested.value = 2
    expect(payload.nested.value).toBe(1)
  })

  it('normalizes numeric values to strings', () => {
    expect(toNumericString(15)).toBe('15')
    expect(toNumericString(null)).toBeNull()
  })

  const entityTests: Array<{
    label: string
    fn: (em: any) => Promise<any>
    expectedArgs: any
  }> = [
    { label: 'requireProduct', fn: (em) => requireProduct(em, 'prod'), expectedArgs: [{ id: 'prod', deletedAt: null }] },
    {
      label: 'requireVariant',
      fn: (em) => requireVariant(em, 'variant'),
      expectedArgs: [{ id: 'variant', deletedAt: null }, { populate: ['product'] }],
    },
    { label: 'requireOffer', fn: (em) => requireOffer(em, 'offer'), expectedArgs: [{ id: 'offer' }] },
    {
      label: 'requireOptionSchemaTemplate',
      fn: (em) => requireOptionSchemaTemplate(em, 'schema'),
      expectedArgs: [{ id: 'schema', deletedAt: null }],
    },
  ]

  for (const { label, fn, expectedArgs } of entityTests) {
    it(`${label} resolves entities or throws`, async () => {
      const entity = { id: 'record' }
      const findOne = jest.fn().mockResolvedValue(entity)
      const em = { findOne }

      await expect(fn(em)).resolves.toBe(entity)
      expect(findOne).toHaveBeenCalledWith(
        expect.any(Function),
        expectedArgs[0],
        expectedArgs[1] ?? undefined,
      )

      findOne.mockResolvedValue(null)
      await expect(fn(em)).rejects.toBeInstanceOf(CrudHttpError)
    })
  }
})
