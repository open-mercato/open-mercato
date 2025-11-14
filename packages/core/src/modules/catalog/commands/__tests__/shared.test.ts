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
  requireOption,
  requireOptionValue,
  requireOffer,
  requireAttributeSchemaTemplate,
} from '../shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

describe('catalog command shared helpers', () => {
  const createCtx = (overrides: Record<string, unknown> = {}) => ({
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: null,
    ...overrides,
  })

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
    { label: 'requireVariant', fn: (em) => requireVariant(em, 'variant'), expectedArgs: [{ id: 'variant', deletedAt: null }] },
    { label: 'requireOption', fn: (em) => requireOption(em, 'option'), expectedArgs: [{ id: 'option' }] },
    { label: 'requireOptionValue', fn: (em) => requireOptionValue(em, 'value'), expectedArgs: [{ id: 'value' }] },
    { label: 'requireOffer', fn: (em) => requireOffer(em, 'offer'), expectedArgs: [{ id: 'offer' }] },
    {
      label: 'requireAttributeSchemaTemplate',
      fn: (em) => requireAttributeSchemaTemplate(em, 'schema'),
      expectedArgs: [{ id: 'schema', deletedAt: null }],
    },
  ]

  for (const { label, fn, expectedArgs } of entityTests) {
    it(`${label} resolves entities or throws`, async () => {
      const entity = { id: 'record' }
      const findOne = jest.fn().mockResolvedValue(entity)
      const em = { findOne }

      await expect(fn(em)).resolves.toBe(entity)
      expect(findOne).toHaveBeenCalledWith(expect.any(Function), expectedArgs[0])

      findOne.mockResolvedValue(null)
      await expect(fn(em)).rejects.toBeInstanceOf(CrudHttpError)
    })
  }
})
