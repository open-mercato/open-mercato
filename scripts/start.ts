import { spawn, ChildProcess } from 'child_process'

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

  // Start Next.js app
  const nextCommand = mode === 'dev' ? ['next', 'dev'] : ['next', 'start']
  const nextProcess = spawn('npx', nextCommand, {
    stdio: 'inherit',
    env: process.env,
  })
  processes.push(nextProcess)

  // Start workers (enabled by default, disable with AUTO_SPAWN_WORKERS=false)
  if (autoSpawnWorkers) {
    console.log('[start] Starting workers for all queues...')
    const workerProcess = spawn(
      'npx',
      ['tsx', '--tsconfig', 'tsconfig.cli.json', 'mercato-cli.ts', 'queue', 'worker', '--all'],
      {
        stdio: 'inherit',
        env: process.env,
      }
    )
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
