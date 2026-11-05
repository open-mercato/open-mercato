import fs from 'node:fs'
import path from 'node:path'

function sanitizeFileSegment(value, fallback = 'log') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || fallback
}

function createRunId() {
  return `${new Date().toISOString().replace(/:/g, '-')}-pid${process.pid}`
}

function stringifyMetadataValue(value) {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function warnOnce(state, message) {
  if (state.warned) return
  state.warned = true
  try {
    console.warn(`[dev-log] ${message}`)
  } catch {
    // ignore — never let logging itself break the dev runner
  }
}

export function createDevLogSession(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const logDir = path.resolve(options.logDir ?? path.join(cwd, '.mercato', 'logs'))
  const role = sanitizeFileSegment(options.role ?? 'dev')
  const generatedRunId = createRunId()
  const runId = sanitizeFileSegment(
    options.runId ?? process.env.OM_DEV_RUN_ID?.trim() ?? generatedRunId,
    generatedRunId,
  )
  const openedLogs = new Map()
  const sessionWarnState = { warned: false }

  let directoryReady = false
  try {
    fs.mkdirSync(logDir, { recursive: true })
    directoryReady = true
  } catch (err) {
    warnOnce(sessionWarnState, `Failed to create log directory ${logDir}: ${err.message}`)
  }

  function openLog(name, metadata = {}) {
    const label = sanitizeFileSegment(name)
    const existing = openedLogs.get(label)
    if (existing) return existing

    const filePath = path.join(logDir, `${runId}-${role}-${label}.log`)
    const fileWarnState = { warned: false }
    let fileExisted = false
    try {
      fileExisted = directoryReady && fs.existsSync(filePath)
    } catch {
      fileExisted = false
    }

    let stream = null
    if (directoryReady) {
      try {
        stream = fs.createWriteStream(filePath, { flags: 'a' })
        stream.on('error', (err) => {
          warnOnce(fileWarnState, `Stream error for ${filePath}: ${err.message}`)
          stream = null
        })
      } catch (err) {
        warnOnce(fileWarnState, `Failed to open ${filePath}: ${err.message}`)
        stream = null
      }
    }

    const writeChunk = (chunk) => {
      if (!stream || chunk === undefined || chunk === null) return
      const payload = Buffer.isBuffer(chunk) || typeof chunk === 'string' ? chunk : String(chunk)
      try {
        stream.write(payload)
      } catch (err) {
        warnOnce(fileWarnState, `Write failed for ${filePath}: ${err.message}`)
      }
    }

    const writeLine = (line = '') => {
      writeChunk(`${line}\n`)
    }

    let closePromise = null
    const close = () => {
      if (closePromise) return closePromise
      const localStream = stream
      stream = null
      if (!localStream) {
        closePromise = Promise.resolve()
        return closePromise
      }
      closePromise = new Promise((resolve) => {
        const finalize = () => resolve()
        localStream.once('finish', finalize)
        localStream.once('close', finalize)
        localStream.once('error', finalize)
        try {
          localStream.end()
        } catch (err) {
          warnOnce(fileWarnState, `Close failed for ${filePath}: ${err.message}`)
          finalize()
        }
      })
      return closePromise
    }

    if (fileExisted) {
      writeLine('')
      writeLine(`# --- Reopened ${new Date().toISOString()} ---`)
    } else {
      const headerLines = [
        '# Open Mercato dev log',
        `# Run ID: ${runId}`,
        `# Role: ${role}`,
        `# Label: ${label}`,
        `# Started At: ${new Date().toISOString()}`,
      ]

      for (const [key, value] of Object.entries(metadata ?? {})) {
        if (value === undefined || value === null) continue
        headerLines.push(`# ${key}: ${stringifyMetadataValue(value)}`)
      }

      writeChunk(`${headerLines.join('\n')}\n\n`)
    }

    const handle = {
      filePath,
      write: writeChunk,
      writeLine,
      close,
    }

    openedLogs.set(label, handle)
    return handle
  }

  function closeAll() {
    const closings = []
    for (const handle of openedLogs.values()) {
      const result = handle.close?.()
      if (result && typeof result.then === 'function') {
        closings.push(result)
      }
    }
    return Promise.all(closings).then(() => undefined)
  }

  return {
    logDir,
    role,
    runId,
    filePattern: path.join(logDir, `${runId}-${role}-*.log`),
    env: {
      OM_DEV_LOG_DIR: logDir,
      OM_DEV_RUN_ID: runId,
    },
    openLog,
    closeAll,
  }
}

export function noteCommandStart(logFile, label, command, args = []) {
  if (!logFile) return

  const renderedArgs = Array.isArray(args) ? args.join(' ') : String(args ?? '')
  logFile.writeLine(`=== ${new Date().toISOString()} ${label} ===`)
  logFile.writeLine(`$ ${[command, renderedArgs].filter(Boolean).join(' ')}`)
}

export function noteCommandEnd(logFile, label, code, signal) {
  if (!logFile) return

  const status = signal
    ? `signal=${signal}`
    : `exit=${code === null || code === undefined ? '?' : code}`
  logFile.writeLine(`=== ${new Date().toISOString()} ${label} done (${status}) ===`)
  logFile.writeLine('')
}

export function attachLoggedProcessStreams(child, logFile, options = {}) {
  if (!child) return

  const stdoutTarget = options.stdout ?? null
  const stderrTarget = options.stderr ?? null
  const writer = logFile?.write ?? null

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      writer?.(chunk)
      stdoutTarget?.write(chunk)
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      writer?.(chunk)
      stderrTarget?.write(chunk)
    })
  }
}

export function formatDevLogAnnouncement(session) {
  return session.filePattern
}
