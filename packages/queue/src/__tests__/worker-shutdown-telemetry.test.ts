import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Regression for PR #25 review: the worker's graceful shutdown closed the queues
 * and called process.exit() without flushing telemetry. A worker never returns
 * from run(), so the CLI's post-run shutdownTelemetry() is unreachable — the
 * BatchSpanProcessor's buffered tail (~5s of spans/logs) was dropped on every
 * restart/redeploy. The shutdown handler must flush BEFORE exiting.
 */

const mockCallOrder: string[] = []

jest.mock('@open-mercato/telemetry', () => ({
  initTelemetry: jest.fn(async () => {}),
  shutdownTelemetry: jest.fn(async () => {
    mockCallOrder.push('flush')
  }),
}))

import { runWorker } from '../worker/runner'

describe('worker shutdown flushes telemetry', () => {
  let tmpDir: string
  let cwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-shutdown-'))
    cwd = process.cwd()
    process.chdir(tmpDir)
    mockCallOrder.length = 0
  })

  afterEach(() => {
    process.chdir(cwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('SIGTERM flushes telemetry after queue close and before process.exit', async () => {
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
