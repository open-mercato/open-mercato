/** @jest-environment node */
const em = { fork: () => em }
const container = { resolve: (name: string) => (name === 'em' ? em : null) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => container) }))
jest.mock('../lib/leaseSweep', () => ({
  listSweepScopes: jest.fn(async () => [{ tenantId: 'tenant-1', organizationId: 'org-1' }]),
  runLeaseSweep: jest.fn(async () => ({ ended: 1, expired: 2, reminded: 3, reenqueued: 7 })),
}))
jest.mock('../lib/bookingSweep', () => ({
  runBookingSweep: jest.fn(async () => ({ completed: 4, reenqueued: 0, resumedClosures: 5 })),
}))

jest.mock('../lib/salesOperationRunner', () => ({
  runSalesOperation: jest.fn(async () => {
    throw new Error('order service down')
  }),
}))

import commands from '../cli'
import { registerTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runLeaseSweep } from '../lib/leaseSweep'
import { runBookingSweep } from '../lib/bookingSweep'

describe('sweep:run', () => {
  it('re-enqueues open sales operations once per organization and reports them once', async () => {
    const command = commands.find((entry) => entry.command === 'sweep:run')
    if (!command) throw new Error('[internal] missing sweep:run')
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await command.run([])
      const leaseDeps = (runLeaseSweep as jest.Mock).mock.calls[0][0] as { enqueuer?: unknown; skipReenqueue?: boolean }
      const bookingDeps = (runBookingSweep as jest.Mock).mock.calls[0][0] as { enqueuer?: unknown; skipReenqueue?: boolean }
      expect(typeof leaseDeps.enqueuer).toBe('function')
      expect(leaseDeps.skipReenqueue).toBeUndefined()
      expect(bookingDeps.skipReenqueue).toBe(true)
      const output = log.mock.calls.map((call) => String(call[0])).join('\n')
      expect(output).toContain('billing operations retried 7,')
      expect(output).toContain('bookings completed 4')
      expect(output).toContain('unavailabilities resumed 5')
    } finally {
      log.mockRestore()
    }
  })

  it('reports a failed inline sales operation to telemetry and keeps going', async () => {
    const command = commands.find((entry) => entry.command === 'sweep:run')
    if (!command) throw new Error('[internal] missing sweep:run')
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as never)
    try {
      ;(runLeaseSweep as jest.Mock).mockClear()
      await command.run([])
      const leaseDeps = (runLeaseSweep as jest.Mock).mock.calls[0][0] as { enqueuer: (ids: readonly string[]) => Promise<void> }
      await leaseDeps.enqueuer(['op-1', 'op-2'])
      expect(reportError).toHaveBeenCalledTimes(2)
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'property_management',
        code: 'property_management.sweep_cli_operation_failed',
      })
      expect(error).toHaveBeenCalledWith('Sales operation op-2 failed:', 'order service down')
    } finally {
      unregister()
      error.mockRestore()
      log.mockRestore()
    }
  })
})
