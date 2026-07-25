import { applyContextScopeToQuery, applyContextScopeToBody } from '../scope-injection'

const NULL_SCOPE = { tenantId: null, organizationId: null }
const BOUND_SCOPE = { tenantId: 'ctx-tenant', organizationId: 'ctx-org' }

describe('applyContextScopeToQuery', () => {
  it('strips AI-supplied scope when ctx scope is null (fail closed)', () => {
    const result = applyContextScopeToQuery(
      { tenantId: 'evil', organizationId: 'evil-org', city: 'NYC' },
      NULL_SCOPE
    )
    expect('tenantId' in result).toBe(false)
    expect('organizationId' in result).toBe(false)
    expect(result.city).toBe('NYC')
  })

  it('overrides AI-supplied scope with ctx scope', () => {
    const result = applyContextScopeToQuery({ tenantId: 'evil' }, BOUND_SCOPE)
    expect(result.tenantId).toBe('ctx-tenant')
    expect(result.organizationId).toBe('ctx-org')
  })

  it('handles undefined query', () => {
    expect(applyContextScopeToQuery(undefined, NULL_SCOPE)).toEqual({})
  })

  it('drops dangerous prototype-pollution keys', () => {
    const result = applyContextScopeToQuery(
      { ['__proto__']: 'x', city: 'NYC' } as Record<string, string>,
      NULL_SCOPE
    )
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false)
    expect(result.city).toBe('NYC')
  })
})

describe('applyContextScopeToBody', () => {
  it('strips AI-supplied scope when ctx scope is null', () => {
    const result = applyContextScopeToBody(
      { name: 'Acme', tenantId: 'evil', organizationId: 'evil-org' },
      NULL_SCOPE
    )
    expect(result.name).toBe('Acme')
    expect('tenantId' in result).toBe(false)
    expect('organizationId' in result).toBe(false)
  })

  it('applies ctx tenant even when only tenantId is scoped', () => {
    const result = applyContextScopeToBody(
      { tenantId: 'evil' },
      { tenantId: 'ctx-tenant', organizationId: null }
    )
    expect(result.tenantId).toBe('ctx-tenant')
    expect('organizationId' in result).toBe(false)
  })

  it('handles undefined body', () => {
    expect(applyContextScopeToBody(undefined, NULL_SCOPE)).toEqual({})
  })

  it('does not mutate the original body object', () => {
    const original = { tenantId: 'evil' }
    applyContextScopeToBody(original, BOUND_SCOPE)
    expect(original.tenantId).toBe('evil')
  })
})
