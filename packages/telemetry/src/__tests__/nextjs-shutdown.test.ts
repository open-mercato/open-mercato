import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Regression: registerTelemetryForNextjs()'s SIGTERM/SIGINT flush handler used
 * to only call shutdownTelemetry() without re-raising the signal. A signal
 * listener suppresses Node's default termination, so a web process that
 * received SIGTERM on deploy flushed telemetry and then stayed alive until the
 * orchestrator force-killed it. The handler must re-raise after the flush so
 * the process still terminates.
 *
 * Runs in a real child process: only a real signal against a real event loop
 * proves the process dies — in-process listener assertions cannot.
 */
const distNextjs = path.resolve(__dirname, '../../dist/nextjs.js')
const pkgRoot = path.resolve(__dirname, '../..')

const CHILD_SCRIPT = `
const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')
await registerTelemetryForNextjs()
setInterval(() => {}, 1000) // keep the event loop alive, like a server would
console.log('READY')
`

// The build output must exist (the child imports the compiled helper). Runs in
// CI after build:packages; skip locally when the package hasn't been built yet.
const maybe = fs.existsSync(distNextjs) ? describe : describe.skip

maybe('registerTelemetryForNextjs shutdown semantics', () => {
  it('a SIGTERM after registration still terminates the process', async () => {
    const scriptFile = path.join(pkgRoot, `.nextjs-shutdown-probe.${process.pid}.mjs`)
    fs.writeFileSync(scriptFile, CHILD_SCRIPT)
    try {
      const child = spawn(process.execPath, [scriptFile], {
        cwd: pkgRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TELEMETRY_BACKEND: 'console' },
      })
      await new Promise<void>((resolve, reject) => {
        const bailout = setTimeout(() => reject(new Error('child never printed READY')), 15_000)
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('READY')) {
            clearTimeout(bailout)
            resolve()
          }
        })
        child.on('error', reject)
      })

      child.kill('SIGTERM')

      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          const bailout = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error('process stayed alive after SIGTERM — the flush handler suppressed termination'))
          }, 10_000)
          child.on('exit', (code, signal) => {
            clearTimeout(bailout)
            resolve({ code, signal })
          })
        },
      )
      // The re-raised signal terminates the process with default semantics.
      expect(outcome.signal).toBe('SIGTERM')
    } finally {
      fs.rmSync(scriptFile, { force: true })
    }
  }, 35_000)
})
