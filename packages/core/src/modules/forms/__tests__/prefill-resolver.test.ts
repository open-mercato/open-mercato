import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormVersionCompiler } from '../services/form-version-compiler'
import {
  DefaultPrefillResolver,
  resolvePrefillSeed,
  type PrefillPrincipal,
  type PrefillResolver,
} from '../services/prefill-resolver'

const principal: PrefillPrincipal = {
  sub: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000222',
  organizationId: '00000000-0000-0000-0000-000000000111',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  customerEntityId: null,
  personEntityId: null,
}

const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })

const compile = (properties: Record<string, unknown>) =>
  compiler.compile({
    id: `prefill-${JSON.stringify(properties).length}-${Math.random()}`,
    updatedAt: new Date(),
    schema: {
      type: 'object',
      'x-om-roles': ['admin', 'patient'],
      properties,
    },
    uiSchema: {},
  })

describe('DefaultPrefillResolver', () => {
  it('maps name → displayName and email → email from the auth context', () => {
    const resolver = new DefaultPrefillResolver()
    const result = resolver.resolve({ principal, attributeKeys: ['name', 'email'] })
    expect(result).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })

  it('omits unknown attribute keys (e.g. dob)', () => {
    const resolver = new DefaultPrefillResolver()
    const result = resolver.resolve({ principal, attributeKeys: ['name', 'dob'] })
    expect(result).toEqual({ name: 'Jane Doe' })
    expect('dob' in result).toBe(false)
  })

  it('omits attributes with empty / missing source values', () => {
    const resolver = new DefaultPrefillResolver()
    const result = resolver.resolve({
      principal: { ...principal, displayName: '', email: null },
      attributeKeys: ['name', 'email'],
    })
    expect(result).toEqual({})
  })

  it('returns {} for an anonymous principal', () => {
    const resolver = new DefaultPrefillResolver()
    expect(resolver.resolve({ principal: null, attributeKeys: ['name', 'email'] })).toEqual({})
  })
})

describe('resolvePrefillSeed', () => {
  const resolver = new DefaultPrefillResolver()

  it('maps resolved attributes onto the fields declaring x-om-prefill', async () => {
    const compiled = compile({
      full_name: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'name' },
      contact_email: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'email' },
    })
    const seed = await resolvePrefillSeed({ compiled, resolver, principal })
    expect(seed).toEqual({ full_name: 'Jane Doe', contact_email: 'jane@example.com' })
  })

  it('does not call the resolver and returns {} when no field declares x-om-prefill', async () => {
    const compiled = compile({
      notes: { type: 'string', 'x-om-type': 'text' },
    })
    const spy: PrefillResolver = {
      resolve: jest.fn().mockReturnValue({ name: 'Should not be used' }),
    }
    const seed = await resolvePrefillSeed({ compiled, resolver: spy, principal })
    expect(seed).toEqual({})
    expect(spy.resolve).not.toHaveBeenCalled()
  })

  it('omits fields whose attribute the resolver could not resolve', async () => {
    const compiled = compile({
      full_name: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'name' },
      birth_date: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'dob' },
    })
    const seed = await resolvePrefillSeed({ compiled, resolver, principal })
    expect(seed).toEqual({ full_name: 'Jane Doe' })
  })

  it('returns {} for an anonymous principal even with x-om-prefill fields', async () => {
    const compiled = compile({
      full_name: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'name' },
    })
    const seed = await resolvePrefillSeed({ compiled, resolver, principal: null })
    expect(seed).toEqual({})
  })

  it('supports a richer injected resolver supplying dob', async () => {
    const richResolver: PrefillResolver = {
      resolve: ({ attributeKeys }) => {
        const out: Record<string, unknown> = {}
        if (attributeKeys.includes('dob')) out.dob = '1990-01-01'
        return out
      },
    }
    const compiled = compile({
      birth_date: { type: 'string', 'x-om-type': 'text', 'x-om-prefill': 'dob' },
    })
    const seed = await resolvePrefillSeed({ compiled, resolver: richResolver, principal })
    expect(seed).toEqual({ birth_date: '1990-01-01' })
  })
})
