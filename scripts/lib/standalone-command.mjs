import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export function createStandaloneCommandRunner({ defaultCwd, retryScript } = {}) {
  let activeChild = null

  async function run(command, args, { cwd = defaultCwd, env = {}, retry = false } = {}) {
    if (activeChild) throw new Error('A standalone child command is already running')
    const invocation = retry
      ? ['bash', [retryScript, command, ...args]]
      : [command, args]
    if (retry && !retryScript) throw new Error('A retry script is required for retryable standalone commands')
    console.log(`$ ${command} ${args.join(' ')}`)
    const child = spawn(invocation[0], invocation[1], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    })
    activeChild = child
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => {
          if (code === 0) resolve()
          else reject(new Error(`Standalone command failed (${code ?? signal ?? 'unknown'}): ${command} ${args.join(' ')}`))
        })
      })
    } finally {
      if (activeChild === child) activeChild = null
    }
  }

  async function stop() {
    const child = activeChild
    if (!child?.pid) return
    const closed = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(true)
      : new Promise((resolve) => child.once('close', () => resolve(true)))
    const signal = (signalName) => {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, signalName)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    signal('SIGTERM')
    const closedGracefully = await Promise.race([closed, delay(5_000).then(() => false)])
    if (!closedGracefully) signal('SIGKILL')
  }

  return { run, stop }
}
