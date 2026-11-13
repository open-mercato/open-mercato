// Keep the host build default while allowing a bounded container-specific heap.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: process.env.OM_BUILD_NODE_OPTIONS ?? '--max-old-space-size=8192' },
})
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
const forward = (signal) => child.kill(signal)
const handlers = new Map(signals.map((signal) => [signal, () => forward(signal)]))
for (const [signal, handler] of handlers) process.on(signal, handler)
const cleanup = () => {
  for (const [signal, handler] of handlers) process.off(signal, handler)
}
child.once('error', (error) => {
  cleanup()
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  cleanup()
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
