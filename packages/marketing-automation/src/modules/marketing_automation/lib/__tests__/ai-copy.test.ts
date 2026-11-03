const reportError = jest.fn()

jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import type { AwilixContainer } from 'awilix'
import { loadBrandVoice } from '../ai-copy'

const scope = { tenantId: 't1', organizationId: 'o1' }

/**
 * The gap this guards: both of `loadBrandVoice`'s catches swallowed to `null` with no `reportError`,
 * so a DI/DB failure was indistinguishable from "this tenant has no brand voice configured" — the
 * author saw a plain draft either way, with zero telemetry signal that something upstream broke.
 */
describe('loadBrandVoice', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  test('reports and returns null when the config service cannot be resolved', async () => {
    const container = { resolve: () => { throw new Error('no such registration') } } as unknown as AwilixContainer
    const result = await loadBrandVoice(container, scope)
    expect(result).toBeNull()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  test('reports and returns null when the config lookup itself throws', async () => {
    const container = {
      resolve: () => ({ getValue: async () => { throw new Error('db down') } }),
    } as unknown as AwilixContainer
    const result = await loadBrandVoice(container, scope)
    expect(result).toBeNull()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  test('returns the trimmed value without reporting anything when it succeeds', async () => {
    const container = {
      resolve: () => ({ getValue: async () => '  Warm, plain, never shouty.  ' }),
    } as unknown as AwilixContainer
    const result = await loadBrandVoice(container, scope)
    expect(result).toBe('Warm, plain, never shouty.')
    expect(reportError).not.toHaveBeenCalled()
  })
})
