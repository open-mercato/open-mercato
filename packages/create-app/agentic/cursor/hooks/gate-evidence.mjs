/**
 * Record validation-gate outcomes, and refuse to finish on unverified source changes (Cursor).
 *
 * Mirrors the claude-code hook: `record` on `afterShellExecution`, `check` on `stop`.
 *
 * Cursor's `afterShellExecution` payload documents `command`, `output`, `duration`, and
 * `sandbox` — no exit code — so the outcome is inferred from output text rather than read.
 * Blocking contract: exit 2 blocks, exit 0 proceeds, other codes fail open.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Extracts every gate a shell command ran.
 *
 * Quoted spans are blanked first: `git commit -m "run tsc --noEmit"` names a gate without
 * running one, and its zero exit status would otherwise be recorded as a green typecheck.
 */
export function matchGates(command) {
  const executable = command.replace(/'[^']*'|"[^"]*"/g, ' ')
  const found = new Set()
  const named = [
    ['typecheck', /\b(?:yarn|npm run|pnpm)\s+typecheck\b|\btsc\b[^&|;]*--noEmit/],
    ['lint', /\b(?:yarn|npm run|pnpm)\s+lint\b|\beslint\b/],
    ['test', /\b(?:yarn|npm run|pnpm)\s+test\b|\bjest\b/],
    ['build', /\b(?:yarn|npm run|pnpm)\s+build\b|\bnext build\b/],
    ['generate', /\b(?:yarn|npm run|pnpm)\s+generate\b|\bmercato\s+generate\b/],
  ]
  for (const [gate, pattern] of named) {
    if (pattern.test(executable)) found.add(gate)
  }
  return [...found]
}

/**
 * Whether a command's outcome can be attributed to the gates it names.
 *
 * A pipeline reports its LAST stage's status, and `;` / `||` break the link the same way.
 * `&&` does not: it short-circuits, so a failure still belongs to a gate that ran.
 */
export function isAttributableGateCommand(command) {
  return !/[|;\n]/.test(command)
}

/** See the claude-code hook. */
export function nextSessionState(previous, sessionId, startedAt) {
  if (!sessionId) {
    return previous.sessionStartedAt ? previous : { ...previous, sessionStartedAt: startedAt }
  }
  if (previous.sessionId === sessionId && previous.sessionStartedAt) return previous
  return { sessionId, sessionStartedAt: startedAt }
}

/** See the claude-code hook: an absent typecheck record does not block on its own. */
export function shouldBlock({ newestSrcMtimeMs, sessionStartedAtMs, lastGreenTypecheckMs }) {
  if (newestSrcMtimeMs === null) return false
  if (newestSrcMtimeMs < sessionStartedAtMs) return false
  if (lastGreenTypecheckMs === null) return true
  return newestSrcMtimeMs > lastGreenTypecheckMs
}

/**
 * Infers a gate outcome from its output, because this host reports no exit code.
 *
 * Returns 1 (failure) for empty output and for any failure signature. The bias is
 * deliberate: over-reporting failure costs one re-run, under-reporting it records a pass
 * that never happened — the property this hook exists to remove. `No tests found` is a
 * failure here for the same reason it is not a pass in the harness rules.
 */
export function inferExitCode(output) {
  if (typeof output !== 'string' || output.trim() === '') return 1
  const failureSignatures = [
    /\berror\s+TS\d+/i, /FATAL ERROR/i, /heap out of memory/i,
    /\bTests?:\s+\d+\s+failed/i, /\bfail(ed|ing)\b/i, /\bERROR\b/,
    /exited \(\d+\)/, /command not found/i, /No tests found/i,
  ]
  return failureSignatures.some((pattern) => pattern.test(output)) ? 1 : 0
}

const STATE_RELATIVE_PATH = '.ai/.gate-state.json'
const WATCHED_ROOT = 'src'

function projectDir() {
  return process.env.CURSOR_PROJECT_DIR || resolve('.')
}

function statePath() { return join(projectDir(), STATE_RELATIVE_PATH) }

function readState() {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')) } catch { return {} }
}

function writeState(state) {
  try {
    mkdirSync(join(projectDir(), '.ai'), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // A hook must never fail the turn over its own bookkeeping.
  }
}

function newestMtimeMs(dir) {
  let newest = null
  const walk = (current) => {
    let entries
    try { entries = readdirSync(current) } catch { return }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(current, entry)
      let stats
      try { stats = statSync(full) } catch { continue }
      if (stats.isDirectory()) walk(full)
      else if (newest === null || stats.mtimeMs > newest) newest = stats.mtimeMs
    }
  }
  walk(dir)
  return newest
}

function readStdin() {
  return new Promise((done) => {
    let raw = ''
    if (process.stdin.isTTY) { done(''); return }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { raw += chunk })
    process.stdin.on('end', () => done(raw))
    process.stdin.on('error', () => done(''))
  })
}

async function main() {
  const mode = process.argv[2] === 'check' ? 'check' : 'record'
  const raw = await readStdin()

  let data = {}
  if (raw.trim()) {
    try { data = JSON.parse(raw) } catch { process.exit(0) }
  }

  const previous = readState()
  const now = new Date()
  const state = nextSessionState(previous, data.session_id ?? null, now.toISOString())
  if (state !== previous) writeState(state)

  if (mode === 'record') {
    const command = data.command ?? data.tool_input?.command
    if (!command) process.exit(0)
    const gates = matchGates(command)
    if (!gates.length) process.exit(0)
    if (!isAttributableGateCommand(command)) process.exit(0)
    const exitCode = inferExitCode(data.output ?? '')
    state.gates = state.gates ?? {}
    for (const gate of gates) {
      state.gates[gate] = { exitCode, finishedAt: now.toISOString() }
    }
    writeState(state)
    process.exit(0)
  }

  if (data.stop_hook_active) process.exit(0)

  const typecheck = state.gates?.typecheck
  const blocked = shouldBlock({
    newestSrcMtimeMs: newestMtimeMs(join(projectDir(), WATCHED_ROOT)),
    sessionStartedAtMs: Date.parse(state.sessionStartedAt ?? now.toISOString()),
    lastGreenTypecheckMs: typecheck && typecheck.exitCode === 0 ? Date.parse(typecheck.finishedAt) : null,
  })
  if (!blocked) process.exit(0)

  process.stderr.write([
    `Source under ${WATCHED_ROOT}/ changed this session and has not passed a typecheck since.`,
    '',
    'Run `yarn typecheck` and report its exit status before finishing.',
    'If it genuinely fails and you cannot fix it, report the failure to the user.',
    '',
  ].join('\n'))
  process.exit(2)
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('gate-evidence.mjs')
if (invokedDirectly) await main()
