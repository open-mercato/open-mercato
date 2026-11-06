// Compact setup output, using the same keyboard and compact log hints as dev.
// Keep this build-free: setup runs before the workspace dependencies exist.
import { StringDecoder } from 'node:string_decoder'
import { format } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const MAX_LINES = 200
const MAX_LINE_LENGTH = 4096

export function createSetupLogs({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
  verbose = false,
  nonInteractive = false,
  repoRoot = null,
  name = 'setup',
  onInterrupt = () => process.kill(process.pid, 'SIGINT'),
} = {}) {
  const interactive = Boolean(input.isTTY && output.isTTY
    && env.CI !== 'true' && env.TERM !== 'dumb' && env.MERCATO_DEV_OUTPUT !== 'verbose'
    && !verbose && !nonInteractive)
  const colored = interactive && !env.NO_COLOR
  let active = false
  let started = false
  let fileInitialized = false
  let logFile = null
  let fileFailed = false
  let activity = null
  let visible = !interactive
  let previousRaw = false
  let previousFlowing = false
  let lines = []
  let partial = ''
  let visiblePartial = false
  let rawLineStart = true
  const decoder = new StringDecoder('utf8')

  const write = (value) => output.write(value)
  const tint = (code, value) => colored ? `\u001b[${code}m${value}\u001b[0m` : value


  function writeRaw(text) {
    let formatted = ''
    for (const part of text.split(/(\r\n|\r|\n)/)) {
      if (part === '\n' || part === '\r' || part === '\r\n') { formatted += part; rawLineStart = true }
      else if (part) { formatted += (rawLineStart ? '   ' : '') + part; rawLineStart = false }
    }
    write(formatted)
  }

  function reportFileFailure() {
    if (fileFailed) return
    fileFailed = true
    activity?.pause()
    write('   ⚠️  Could not save setup logs; terminal output is still available.\n')
    if (active && !visible) activity?.resume()
  }

  function initializeFile() {
    if (fileInitialized) return
    fileInitialized = true
    if (!repoRoot || ['0', 'false'].includes(env.OM_DEV_LOG_TEE)) return
    try {
      const directory = env.OM_DEV_LOG_DIR?.trim()
        ? path.resolve(repoRoot, env.OM_DEV_LOG_DIR.trim())
        : path.join(repoRoot, '.mercato', 'logs')
      const defaultId = `${new Date().toISOString().toLowerCase().replace(/[:.]/g, '-')}-pid${process.pid}`
      // Run IDs are filenames, never paths, including when supplied by a shell.
      const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 160)
      const runId = safe(env.OM_DEV_RUN_ID?.trim() || defaultId)
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      const target = path.join(directory, `${runId}-${safe(name)}-raw.log`)
      fs.appendFileSync(target, '', { mode: 0o600 })
      logFile = target
    } catch {
      reportFileFailure()
    }
  }

  function show(reason = 'Raw logs shown') {
    if (!interactive || visible) return
    activity?.pause()
    visible = true
    write(`   📖 ${reason} · press [d] to hide\n`)
    rawLineStart = true
    if (lines.length === 0 && !partial) {
      write('   📭 No buffered logs yet\n')
      return
    }
    if (lines.length > 0) writeRaw(`${lines.join('\n')}\n`)
    if (partial) writeRaw(partial)
    visiblePartial = partial.length > 0
    // Displayed output remains in terminal scrollback and in the full log
    // file. Replay only new output collected while the panel was hidden.
    lines = []
    partial = ''
  }

  function onData(chunk) {
    for (const key of String(chunk)) {
      if (key === '\u0003') {
        suspend()
        onInterrupt()
        return
      }
      if (key.toLowerCase() !== 'd') continue
      if (visible) {
        visible = false
        if (visiblePartial) write('\n')
        visiblePartial = false
        rawLineStart = true
        activity?.resume()
      } else show()
    }
  }

  function resume() {
    if (!interactive || active) return
    previousRaw = Boolean(input.isRaw)
    previousFlowing = input.readableFlowing === true
    input.setRawMode?.(true)
    input.on('data', onData)
    input.resume()
    active = true
  }

  function suspend() {
    activity?.pause()
    if (!active) return
    input.removeListener('data', onData)
    input.setRawMode?.(previousRaw)
    if (!previousFlowing) input.pause()
    active = false
  }

  function persist(chunk) {
    initializeFile()
    if (logFile && !fileFailed) {
      try {
        // Synchronous appends avoid losing the last output when setup hands
        // over to dev or a failing command exits immediately.
        fs.appendFileSync(logFile, chunk)
      } catch {
        reportFileFailure()
      }
    }
  }

  function raw(chunk, displayChunk = chunk) {
    persist(chunk)
    if (!interactive) {
      write(chunk)
      return
    }
    const text = typeof displayChunk === 'string' ? displayChunk : decoder.write(displayChunk)
    if (visible) {
      if (text) { writeRaw(text); visiblePartial = !text.endsWith('\n') }
      return
    }
    // Bound both completed lines and partial progress output. A process can
    // emit megabytes without a newline; it must not grow the buffer forever.
    const entries = `${partial}${text}`.split('\n')
    partial = entries.pop().slice(-MAX_LINE_LENGTH)
    if (entries.length > 0) {
      lines = lines.concat(entries.slice(-MAX_LINES).map((line) => line.slice(-MAX_LINE_LENGTH))).slice(-MAX_LINES)
    }
  }

  return {
    interactive,
    setActivity(next) {
      activity?.stop()
      activity = next
      if (visible) activity?.pause()
      else activity?.resume()
    },
    resumeActivity() { if (!visible && active) activity?.resume() },
    get logFile() { return logFile },
    start() {
      if (started) return
      started = true
      initializeFile()
      if (logFile && !fileFailed) write(`   📝 Verbose logs ${logFile}\n`)
      if (interactive) write(`${tint('2', '   📋 Press [d] to show or hide raw logs')}\n`)
      process.once('exit', suspend)
      resume()
    },
    stop() { activity?.stop(); activity = null; suspend(); process.removeListener('exit', suspend); started = false },
    suspend,
    resume,
    raw,
    show,
    log(...args) {
      const text = format(...args)
      raw(`${text}\n`, `${text.replace(/^ {1,3}/gm, '')}\n`)
    },
    record(...args) { persist(`${format(...args)}\n`) },
  }
}
