const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import type { EntityManager } from '@mikro-orm/postgresql'
import { XRAY_INGEST_TOGGLE_ID, isXrayIngestEnabled, seedXrayIngestToggle, type ServiceResolver } from '../killSwitch'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'

function resolverWith(service: unknown): ServiceResolver {
  return <TService>(name: string) => (name === 'featureTogglesService' ? service as TService : undefined)
}

describe('isXrayIngestEnabled', () => {
  it('fails open without the feature toggles module', async () => {
    expect(await isXrayIngestEnabled(resolverWith(undefined), TENANT_ID)).toBe(true)
  })

  it('is disabled only when the toggle explicitly resolves to false', async () => {
    const getBoolConfig = jest.fn(async () => ({ ok: true, value: false }))
    expect(await isXrayIngestEnabled(resolverWith({ getBoolConfig }), TENANT_ID)).toBe(false)
    expect(getBoolConfig).toHaveBeenCalledWith(XRAY_INGEST_TOGGLE_ID, TENANT_ID)
    expect(await isXrayIngestEnabled(resolverWith({ getBoolConfig: async () => ({ ok: true, value: true }) }), TENANT_ID)).toBe(true)
    expect(await isXrayIngestEnabled(resolverWith({ getBoolConfig: async () => ({ ok: false }) }), TENANT_ID)).toBe(true)
  })

  it('fails open when the lookup throws, and reports the failure', async () => {
    const failure = new Error('boom')
    const getBoolConfig = jest.fn(async () => {
      throw failure
    })
    reportErrorMock.mockClear()
    expect(await isXrayIngestEnabled(resolverWith({ getBoolConfig }), TENANT_ID)).toBe(true)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'insights', code: 'insights.xray_toggle_lookup_failed' }))
  })
})

describe('seedXrayIngestToggle', () => {
  beforeEach(() => findOneWithDecryptionMock.mockReset())

  it('does nothing when the feature toggles module is absent', async () => {
    const em = { persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
    await seedXrayIngestToggle(em as unknown as EntityManager, { hasRegistration: () => false })
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('creates the default-on toggle once and never resurrects an existing one', async () => {
    const em = { persist: jest.fn(), create: jest.fn((_entity: unknown, data: unknown) => data), flush: jest.fn() }
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    await seedXrayIngestToggle(em as unknown as EntityManager, { hasRegistration: () => true })
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ identifier: XRAY_INGEST_TOGGLE_ID, type: 'boolean', defaultValue: true }))
    expect(em.flush).toHaveBeenCalledTimes(1)
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: 'existing' })
    await seedXrayIngestToggle(em as unknown as EntityManager, { hasRegistration: () => true })
    expect(em.persist).toHaveBeenCalledTimes(1)
  })

  it('never fails tenant setup', async () => {
    findOneWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
    const em = { persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
    await expect(seedXrayIngestToggle(em as unknown as EntityManager, { hasRegistration: () => true })).resolves.toBeUndefined()
  })
})
