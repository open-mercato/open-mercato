import { spawn } from 'node:child_process'

const isWindows = process.platform === 'win32'
const yarnCommand = isWindows ? 'yarn.cmd' : 'yarn'
const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'

const children = new Set()
let shuttingDown = false

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function appendLines(target, chunk, onLine) {
  target.value += chunk

  while (true) {
    const newlineIndex = target.value.indexOf('\n')
    if (newlineIndex === -1) break

    const rawLine = target.value.slice(0, newlineIndex).replace(/\r$/, '')
    target.value = target.value.slice(newlineIndex + 1)
    onLine(rawLine)
  }
}

function connectLineStream(stream, onLine) {
  if (!stream) return

  const state = { value: '' }
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => appendLines(state, chunk, onLine))
  stream.on('end', () => {
    const trailing = state.value.replace(/\r$/, '')
    if (trailing.length > 0) {
      onLine(trailing)
    }
  })
}

function spawnCommand(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      TURBO_NO_UPDATE_NOTIFIER: '1',
      ...options.env,
    },
    stdio: options.stdio ?? 'pipe',
  })

  children.add(child)

  child.on('close', () => {
    children.delete(child)
  })

  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })

  return child
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }, 3000).unref()

  process.exit(exitCode)
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

function isIgnorableTurboLine(line) {
  const plain = stripAnsi(line).trim()
  if (plain.length === 0) return true
  if (plain.startsWith('• turbo ')) return true
  if (plain.startsWith('• Packages in scope:')) return true
  if (plain.startsWith('• Running build in ')) return true
  if (plain.startsWith('• Running watch in ')) return true
  if (plain.startsWith('• Remote caching disabled')) return true
  if (plain.startsWith('Tasks:')) return true
  if (plain.startsWith('Cached:')) return true
  if (plain.startsWith('Time:')) return true
  if (/^[╭│╰]/.test(plain)) return true
  if (plain === '^C    ...Finishing writing to cache...') return true
  return false
}

async function runStage(label, commandArgs) {
  const startedAt = Date.now()
  console.log(`${label}...`)

  if (verbose) {
    const child = spawnCommand(yarnCommand, commandArgs, { stdio: 'inherit' })
    const code = await new Promise((resolve) => child.on('close', resolve))
    if ((code ?? 1) !== 0) {
      shutdown(code ?? 1)
    }
    return
  }

  const child = spawnCommand(yarnCommand, commandArgs)
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const code = await new Promise((resolve) => child.on('close', resolve))

  if ((code ?? 1) !== 0) {
    console.error(`❌ ${label} failed`)
    for (const line of capturedLines) {
      console.error(line)
    }
    shutdown(code ?? 1)
  }

  console.log(`✅ ${label} in ${formatDuration(Date.now() - startedAt)}`)
}

function startPackageWatch() {
  console.log('👀 Watching workspace packages')

  const child = spawnCommand(yarnCommand, [
    'turbo',
    'run',
    'watch',
    '--filter=./packages/*',
    '--parallel',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ], {
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (verbose) {
    child.on('close', (code) => {
      if (!shuttingDown && (code ?? 1) !== 0) {
        console.error('❌ Package watch stopped')
        shutdown(code ?? 1)
      }
    })
    return child
  }

  let surfacedFailure = false

  const handleLine = (line) => {
    if (isIgnorableTurboLine(line)) return

    if (!surfacedFailure) {
      surfacedFailure = true
      console.error('❌ Package watch emitted raw output')
    }

    console.error(line)
  }

  connectLineStream(child.stdout, handleLine)
  connectLineStream(child.stderr, handleLine)

  child.on('close', (code) => {
    if (!shuttingDown && (code ?? 1) !== 0) {
      console.error('❌ Package watch stopped')
      shutdown(code ?? 1)
    }
  })

  return child
}

async function main() {
  await runStage('🧱 Building workspace packages', [
    'turbo',
    'run',
    'build',
    '--filter=./packages/*',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ])

  startPackageWatch()

  const appArgs = ['workspace', '@open-mercato/app', 'dev']
  if (verbose) {
    appArgs.push('--verbose')
  }

  console.log('🚀 Starting app runtime')
  const app = spawnCommand(yarnCommand, appArgs, {
    stdio: 'inherit',
  })

  app.on('close', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
    }
  })
}

await main()
