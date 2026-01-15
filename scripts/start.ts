import { spawn, ChildProcess } from 'child_process'
import path from 'node:path'

const processes: ChildProcess[] = []

function cleanup() {
  console.log('[start] Shutting down...')
  for (const proc of processes) {
    if (!proc.killed) {
      proc.kill('SIGTERM')
    }
  }
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

async function main() {
  const mode = process.argv[2] || 'dev'
  const autoSpawnWorkers = process.env.AUTO_SPAWN_WORKERS !== 'false'

  console.log(`[start] Starting Open Mercato in ${mode} mode...`)

  // Resolve local binaries from node_modules/.bin to avoid relying on global npx
  const isWin = process.platform === 'win32'
  const bin = (name: string) =>
    path.resolve(process.cwd(), 'node_modules', '.bin', isWin ? `${name}.cmd` : name)

  // Start Next.js app
  const nextBin = bin('next')
  const nextArgs = mode === 'dev' ? ['dev'] : ['start']
  const nextProcess = spawn(nextBin, nextArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
    windowsVerbatimArguments: !isWin,
  })
  processes.push(nextProcess)

  // Start workers (enabled by default, disable with AUTO_SPAWN_WORKERS=false)
  if (autoSpawnWorkers) {
    console.log('[start] Starting workers for all queues...')
    const tsxBin = bin('tsx')
    const workerProcess = spawn(tsxBin, ['--tsconfig', 'tsconfig.cli.json', 'mercato-cli.ts', 'queue', 'worker', '--all'], {
      stdio: 'inherit',
      env: process.env,
      shell: isWin,
      windowsVerbatimArguments: !isWin,
    })
    processes.push(workerProcess)
  }

  // Wait for any process to exit
  await Promise.race(
    processes.map(
      (proc) =>
        new Promise<void>((resolve) => {
          proc.on('exit', () => resolve())
        })
    )
  )

  cleanup()
  process.exit(0)
}

main().catch((err) => {
  console.error('[start] Error:', err)
  cleanup()
  process.exit(1)
})
