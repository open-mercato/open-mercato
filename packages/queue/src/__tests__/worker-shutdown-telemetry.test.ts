import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Regression: the worker's graceful shutdown used to close the queues
 * and call process.exit() without flushing telemetry. A worker never returns
 * from run(), so the CLI's post-run shutdownTelemetry() is unreachable — the
 * BatchSpanProcessor's buffered tail (~5s of spans/logs) was dropped on every
 * restart/redeploy. The shutdown handler must flush BEFORE exiting.
 */

import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

import { runWorker } from '../worker/runner'

const mockCallOrder: string[] = []
const runtime: TelemetryRuntime = {
  canUseGlobalTracePropagation: () => false,
  captureTraceContext: () => ({}),
  continueTrace: (_carrier, _name, fn) => fn(),
  recordHttpDuration: () => {},
  reportError: () => {},
  shutdown: jest.fn(async () => {
    mockCallOrder.push('flush')
  }),
}

describe('worker shutdown flushes telemetry', () => {
  let tmpDir: string
  let cwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-shutdown-'))
    cwd = process.cwd()
    process.chdir(tmpDir)
    mockCallOrder.length = 0
    delete process.env.TELEMETRY_BACKEND
    registerTelemetryRuntime(runtime)
  })

  afterEach(() => {
    process.chdir(cwd)
    resetTelemetryRuntime()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('SIGTERM flushes telemetry before process.exit', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      mockCallOrder.push(`exit:${code ?? 0}`)
      return undefined as never
    }) as never)
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runWorker({
        queueName: 'shutdown-flush-test',
        handler: async () => {},
        strategy: 'local',
        background: true,
        gracefulShutdown: true,
      })

      process.emit('SIGTERM')
      // The shutdown handler is async (close → flush → exit); let it settle.
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mockCallOrder).toContain('flush')
      expect(mockCallOrder).toContain('exit:0')
      expect(mockCallOrder.indexOf('flush')).toBeLessThan(mockCallOrder.indexOf('exit:0'))
    } finally {
      exitSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})
