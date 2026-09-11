import {
  buildTenantDomain,
  computeEnvFingerprint,
  readOperatorsBlob,
  resolveAppHost,
  saveOperatorsBlob,
  TILLIO_OPERATORS_INTEGRATION_ID,
  type TillioCredentialsService,
} from '../lib/operators-store'

const scope = { tenantId: 'tn', organizationId: 'org' }

function fakeCredentialsService(initial: Record<string, Record<string, unknown> | null> = {}): {
  service: TillioCredentialsService
  store: Record<string, Record<string, unknown> | null>
} {
  const store: Record<string, Record<string, unknown> | null> = { ...initial }
  return {
    store,
    service: {
      getRaw: jest.fn(async (id: string) => store[id] ?? null),
      save: jest.fn(async (id: string, credentials: Record<string, unknown>) => {
        store[id] = credentials
      }),
    },
  }
}

describe('computeEnvFingerprint', () => {
  const env = { tenantSystemId: 'OM-x', apiUrl: 'https://a.example.com', apiKey: 'k' }

  it('is deterministic for the same input', () => {
    expect(computeEnvFingerprint(env)).toBe(computeEnvFingerprint({ ...env }))
    expect(computeEnvFingerprint(env)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when any field changes', () => {
    expect(computeEnvFingerprint(env)).not.toBe(computeEnvFingerprint({ ...env, apiKey: 'k2' }))
    expect(computeEnvFingerprint(env)).not.toBe(computeEnvFingerprint({ ...env, apiUrl: 'https://b.example.com' }))
    expect(computeEnvFingerprint(env)).not.toBe(computeEnvFingerprint({ ...env, tenantSystemId: 'OM-y' }))
  })
})

describe('resolveAppHost / buildTenantDomain', () => {
  it('strips the scheme and keeps host', () => {
    expect(resolveAppHost('https://app.example.com')).toBe('app.example.com')
  })

  it('keeps the port when present', () => {
    expect(resolveAppHost('https://app.example.com:8443')).toBe('app.example.com:8443')
  })

  it('falls back to the authority when there is no scheme', () => {
    expect(resolveAppHost('app.example.com/ignored')).toBe('app.example.com')
  })

  it('returns empty for a blank url', () => {
    expect(resolveAppHost('   ')).toBe('')
  })

  it('builds host/{tenantSystemId}-{operatorId}', () => {
    expect(buildTenantDomain('https://app.example.com', 'OM-x', 'ringostat-1')).toBe('app.example.com/OM-x-ringostat-1')
  })

  it('throws when APP_URL cannot be resolved to a host', () => {
    expect(() => buildTenantDomain('   ', 'OM-x', 'ringostat-1')).toThrow()
  })
})

describe('readOperatorsBlob / saveOperatorsBlob', () => {
  it('returns an empty blob when nothing is stored', async () => {
    const { service } = fakeCredentialsService()
    expect(await readOperatorsBlob(service, scope)).toEqual({ operators: [], defaultOperatorId: null })
  })

  it('returns an empty blob when the stored value is malformed', async () => {
    const { service } = fakeCredentialsService({ [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: 'nope' } })
    expect(await readOperatorsBlob(service, scope)).toEqual({ operators: [], defaultOperatorId: null })
  })

  it('parses a valid stored blob', async () => {
    const operator = {
      id: 'ringostat-1',
      plugin: 'Ringostat',
      config: { key: 'secret' },
      token: 'tok',
      tenantDomain: 'app.example.com/OM-x-ringostat-1',
      envFingerprint: 'fp',
    }
    const { service } = fakeCredentialsService({
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [operator], defaultOperatorId: 'ringostat-1' },
    })
    const blob = await readOperatorsBlob(service, scope)
    expect(blob.operators).toHaveLength(1)
    expect(blob.defaultOperatorId).toBe('ringostat-1')
  })

  it('saves under the tillio_operators key', async () => {
    const { service, store } = fakeCredentialsService()
    await saveOperatorsBlob(service, scope, { operators: [], defaultOperatorId: null })
    expect(service.save).toHaveBeenCalledWith(TILLIO_OPERATORS_INTEGRATION_ID, { operators: [], defaultOperatorId: null }, scope)
    expect(store[TILLIO_OPERATORS_INTEGRATION_ID]).toEqual({ operators: [], defaultOperatorId: null })
  })
})
