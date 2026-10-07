import type { TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { flushTelemetry } from '../flush-telemetry'

function runtimeWithShutdown(shutdown: () => Promise<void>): TelemetryRuntime {
  return { shutdown } as unknown as TelemetryRuntime
}

describe('flushTelemetry', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('shuts the runtime down', async () => {
    const shutdown = jest.fn().mockResolvedValue(undefined)
    await flushTelemetry(runtimeWithShutdown(shutdown))
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('resolves with a warning when the exporter rejects on shutdown', async () => {
    const shutdown = jest.fn().mockRejectedValue(new Error('Export failed with retryable status'))
    await expect(flushTelemetry(runtimeWithShutdown(shutdown))).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Export failed with retryable status'))
  })

  it('is a no-op without a telemetry runtime', async () => {
    await expect(flushTelemetry(undefined)).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})
