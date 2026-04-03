import { spawn } from 'node:child_process'

const command = process.platform === 'win32' ? 'mercato.cmd' : 'mercato'
const verbose = process.argv.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'
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

function looksLikeFailure(line) {
  if (line.startsWith('⨯ preloadEntriesOnStart')) return false
  if (line.startsWith('⨯ serverMinification')) return false
  if (line.startsWith('⨯ turbopackMinify')) return false

  return /^error\b/i.test(line)
    || /^Error:/i.test(line)
    || /^⨯\s/.test(line)
    || /\bfailed\b/i.test(line)
    || /\bexception\b/i.test(line)
    || /Unable to acquire lock/i.test(line)
}

function spawnMercato(args) {
  const child = spawn(command, args, {
    stdio: verbose ? 'inherit' : 'pipe',
    env: {
      ...process.env,
      OM_CLI_QUIET: verbose ? process.env.OM_CLI_QUIET : '1',
      DOTENV_CONFIG_QUIET: verbose ? process.env.DOTENV_CONFIG_QUIET : 'true',
    },
  })

  children.add(child)
  child.on('exit', () => {
    children.delete(child)
  })

  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })

  return child
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
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

async function runInitialGenerate() {
  const startedAt = Date.now()
  console.log('🧱 Generating app artifacts...')

  if (verbose) {
    const child = spawnMercato(['generate'])
    const result = await waitForExit(child)
    if (result.signal) shutdown(1)
    if ((result.code ?? 1) !== 0) shutdown(result.code ?? 1)
    return
  }

  const child = spawnMercato(['generate'])
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const result = await waitForExit(child)
  if (result.signal) {
    shutdown(1)
  }

  if ((result.code ?? 1) !== 0) {
    console.error('❌ Artifact generation failed')
    for (const line of capturedLines) {
      console.error(line)
    }
    shutdown(result.code ?? 1)
  }

  console.log(`✅ App artifacts ready in ${formatDuration(Date.now() - startedAt)}`)
}

function createFilteredReporter(label, classifyLine) {
  let passthrough = false
  let lastStatus = null
  const buffer = []

  return (line) => {
    const plain = stripAnsi(line).trim()
    if (plain.length === 0) return

    buffer.push(line)
    if (buffer.length > 120) {
      buffer.shift()
    }

    if (passthrough) {
      console.error(line)
      return
    }

    const result = classifyLine(plain)

    if (result.type === 'ignore') {
      return
    }

    if (result.type === 'status') {
      if (result.message && result.message !== lastStatus) {
        lastStatus = result.message
        console.log(result.message)
      }
      return
    }

    passthrough = true
    console.error(`❌ ${label} emitted raw output`)
    for (const bufferedLine of buffer) {
      console.error(bufferedLine)
    }
  }
}

function classifyWatchLine(line) {
  if (line.startsWith('🚀 Running generate:watch')) {
    return { type: 'status', message: '👀 Watching module structure' }
  }
  if (line.startsWith('[generate:watch]')) {
    return { type: 'status', message: '👀 Watching module structure' }
  }
  if (line.startsWith('[Bootstrap] Entity IDs re-registered')) {
    return { type: 'ignore' }
  }
  if (line.includes('All generators completed')) {
    return { type: 'status', message: '♻️ Generated files refreshed' }
  }
  if (looksLikeFailure(line)) {
    return { type: 'passthrough' }
  }
  return { type: 'ignore' }
}

function classifyServerLine(line) {
  if (line.startsWith('🚀 Running server:dev')) {
    return { type: 'status', message: '🚀 Starting app server' }
  }
  if (line === '[server] Starting Open Mercato in dev mode...') {
    return { type: 'status', message: '🚀 Starting app server' }
  }
  if (
    line === '[server] Starting workers for all queues...'
    || line === '[server] Starting scheduler polling engine...'
    || line.startsWith('🚀 Running queue:worker')
    || line.startsWith('🚀 Running scheduler:start')
  ) {
    return { type: 'status', message: '⚙️ Starting background services' }
  }

  const localMatch = line.match(/^- Local:\s*(.+)$/)
  if (localMatch) {
    return { type: 'status', message: `🌐 App ready at ${localMatch[1]}` }
  }

  if (line.includes('Using derived tenant encryption keys')) {
    return { type: 'status', message: '🔐 Using dev fallback tenant encryption secret' }
  }

  if (
    line.startsWith('Source: ')
    || line.startsWith('Secret: ')
    || line.startsWith('Persist this secret securely.')
    || line.startsWith('▲ Next.js ')
    || line === '✓ Starting...'
    || line.startsWith('- Network:')
    || line.startsWith('- Environments:')
    || line.startsWith('- Experiments')
    || line.startsWith('⨯ preloadEntriesOnStart')
    || line.startsWith('⨯ serverMinification')
    || line.startsWith('⨯ turbopackMinify')
    || line.startsWith('[Bootstrap] Entity IDs re-registered')
    || line.startsWith('[worker]')
    || line.startsWith('[queue:')
    || line.startsWith('[scheduler:')
    || line.startsWith('🚀 Starting scheduler')
    || line.startsWith('✓ Local scheduler started')
    || line === 'Press Ctrl+C to stop.'
    || line.startsWith('💡 Tip:')
    || line.startsWith('━━━━━━━━')
  ) {
    return { type: 'ignore' }
  }

  if (line.startsWith('⚠ ')) {
    return { type: 'status', message: line }
  }

  if (looksLikeFailure(line)) {
    return { type: 'passthrough' }
  }

  return { type: 'ignore' }
}

function startFilteredChild(args, label, classifyLine) {
  const child = spawnMercato(args)

  if (verbose) {
    return child
  }

  const reporter = createFilteredReporter(label, classifyLine)
  connectLineStream(child.stdout, reporter)
  connectLineStream(child.stderr, reporter)
  return child
}

await runInitialGenerate()

const watch = startFilteredChild(['generate', 'watch', '--skip-initial'], 'Generator watch', classifyWatchLine)
const server = startFilteredChild(['server', 'dev'], 'App runtime', classifyServerLine)

const result = await Promise.race([waitForExit(watch), waitForExit(server)])

if (result.signal) {
  shutdown(1)
}

shutdown(result.code ?? 0)
