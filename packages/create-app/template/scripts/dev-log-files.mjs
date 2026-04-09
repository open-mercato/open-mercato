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

  fs.mkdirSync(logDir, { recursive: true })

  function openLog(name, metadata = {}) {
    const label = sanitizeFileSegment(name)
    const existing = openedLogs.get(label)
    if (existing) return existing

    const filePath = path.join(logDir, `${runId}-${role}-${label}.log`)
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

    fs.writeFileSync(filePath, `${headerLines.join('\n')}\n\n`, 'utf8')

    const handle = {
      filePath,
      append(chunk) {
        if (chunk === undefined || chunk === null) return
        fs.appendFileSync(filePath, Buffer.isBuffer(chunk) || typeof chunk === 'string' ? chunk : String(chunk))
      },
      appendLine(line = '') {
        fs.appendFileSync(filePath, `${line}\n`, 'utf8')
      },
    }

    openedLogs.set(label, handle)
    return handle
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
  }
}

export function noteCommandStart(logFile, label, command, args = []) {
  if (!logFile) return

  const renderedArgs = Array.isArray(args) ? args.join(' ') : String(args ?? '')
  logFile.appendLine(`=== ${new Date().toISOString()} ${label} ===`)
  logFile.appendLine(`$ ${[command, renderedArgs].filter(Boolean).join(' ')}`)
}

export function attachLoggedProcessStreams(child, logFile, options = {}) {
  if (!child) return

  const stdoutTarget = options.stdout ?? null
  const stderrTarget = options.stderr ?? null

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      logFile?.append(chunk)
      stdoutTarget?.write(chunk)
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      logFile?.append(chunk)
      stderrTarget?.write(chunk)
    })
  }
}

export function formatDevLogAnnouncement(session) {
  return session.filePattern
}
