import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

import {
  EMPTY_OTEL_EXPORT_HEALTH,
  OTEL_EXPORT_HEALTH_CONFIG_NAME,
  readOtelExportHealth,
  recordOtelExportHealth,
} from '../lib/trace/otel/exportHealth'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const AT = new Date('2026-10-27T12:00:00.000Z')

function makeContainer(
  record: unknown,
  options: { withStore?: boolean; readRejects?: boolean; writeRejects?: boolean } = {},
) {
  const getRecord = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const setValue = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  if (options.readRejects) getRecord.mockRejectedValue(new Error('store down'))
  else getRecord.mockResolvedValue(record)
  if (options.writeRejects) setValue.mockRejectedValue(new Error('write failed'))
  else setValue.mockResolvedValue(null)
  return {
    getRecord,
    setValue,
    container: {
      resolve: (token: string) => {
        if (token === 'moduleConfigService' && options.withStore !== false) return { getRecord, setValue }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    },
  }
}

beforeEach(() => {
  reportError.mockClear()
})

describe('readOtelExportHealth', () => {
  test('reads the stored tenant record', async () => {
    const stored = { lastSuccessAt: '2026-10-27T10:00:00.000Z', lastErrorAt: null, lastErrorCode: null }
    const { container, getRecord } = makeContainer({ value: stored, source: 'tenant' })
    expect(await readOtelExportHealth(container as never, TENANT_ID)).toEqual(stored)
    expect(getRecord).toHaveBeenCalledWith('agent_orchestrator', OTEL_EXPORT_HEALTH_CONFIG_NAME, { tenantId: TENANT_ID })
  })

  test('never throws and yields the empty record on failure', async () => {
    expect(await readOtelExportHealth(makeContainer(null).container as never, TENANT_ID)).toEqual(
      EMPTY_OTEL_EXPORT_HEALTH,
    )
    expect(
      await readOtelExportHealth(makeContainer(null, { withStore: false }).container as never, TENANT_ID),
    ).toEqual(EMPTY_OTEL_EXPORT_HEALTH)
    expect(
      await readOtelExportHealth(makeContainer(null, { readRejects: true }).container as never, TENANT_ID),
    ).toEqual(EMPTY_OTEL_EXPORT_HEALTH)
    expect(
      await readOtelExportHealth(
        makeContainer({ value: { lastSuccessAt: 42 }, source: 'tenant' }).container as never,
        TENANT_ID,
      ),
    ).toEqual(EMPTY_OTEL_EXPORT_HEALTH)
    expect(
      await readOtelExportHealth(
        makeContainer({ value: { lastSuccessAt: 'x' }, source: 'instance' }).container as never,
        TENANT_ID,
      ),
    ).toEqual(EMPTY_OTEL_EXPORT_HEALTH)
  })
})

describe('recordOtelExportHealth', () => {
  const previous = {
    lastSuccessAt: '2026-10-26T10:00:00.000Z',
    lastErrorAt: '2026-10-26T11:00:00.000Z',
    lastErrorCode: 'http_503',
  }

  test('records a success and keeps the last error', async () => {
    const { container, setValue } = makeContainer({ value: previous, source: 'tenant' })
    await recordOtelExportHealth(container as never, TENANT_ID, { outcome: 'success', at: AT })
    expect(setValue).toHaveBeenCalledWith(
      'agent_orchestrator',
      OTEL_EXPORT_HEALTH_CONFIG_NAME,
      { ...previous, lastSuccessAt: AT.toISOString() },
      { tenantId: TENANT_ID },
    )
  })

  test('records an error with a sanitized code and keeps the last success', async () => {
    const { container, setValue } = makeContainer({ value: previous, source: 'tenant' })
    await recordOtelExportHealth(container as never, TENANT_ID, { outcome: 'error', errorCode: 'timeout', at: AT })
    expect(setValue.mock.calls[0][2]).toEqual({ ...previous, lastErrorAt: AT.toISOString(), lastErrorCode: 'timeout' })

    await recordOtelExportHealth(container as never, TENANT_ID, {
      outcome: 'error',
      errorCode: 'Bearer abc def',
      at: AT,
    })
    expect(setValue.mock.calls[1][2]).toMatchObject({ lastErrorCode: 'unknown' })
  })

  test('starts from an empty record when none is stored', async () => {
    const { container, setValue } = makeContainer(null)
    await recordOtelExportHealth(container as never, TENANT_ID, { outcome: 'success', at: AT })
    expect(setValue.mock.calls[0][2]).toEqual({ ...EMPTY_OTEL_EXPORT_HEALTH, lastSuccessAt: AT.toISOString() })
  })

  test('swallows write failures and reports them', async () => {
    const { container } = makeContainer(null, { writeRejects: true })
    await expect(
      recordOtelExportHealth(container as never, TENANT_ID, { outcome: 'success', at: AT }),
    ).resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'agent_orchestrator', code: 'otel_export_health_write_failed' }),
    )
  })

  test('is a no-op without a config store', async () => {
    const { container, setValue } = makeContainer(null, { withStore: false })
    await expect(
      recordOtelExportHealth(container as never, TENANT_ID, { outcome: 'success', at: AT }),
    ).resolves.toBeUndefined()
    expect(setValue).not.toHaveBeenCalled()
  })
})
