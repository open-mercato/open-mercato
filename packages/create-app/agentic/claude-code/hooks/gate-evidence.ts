/**
 * Record validation-gate outcomes, and refuse to conclude on unverified source changes.
 *
 * Two modes, mirroring `entity-migration-check`'s shape:
 *
 * - `record` (PostToolUse on Bash) — when a Bash command was a validation gate AND its exit
 *   status genuinely belongs to that gate, append the status to `.ai/.gate-state.json`.
 * - `check` (Stop) — block when a file under `src/` changed after the session started and is
 *   newer than the last exit-0 typecheck, unless this stop is already the result of a block.
 *
 * Why this exists: a gate that is claimed but never run is indistinguishable, in a
 * transcript, from one that passed. This makes the difference mechanical.
 *
 * Deliberate limits. The blocker only considers `typecheck`: demanding a green `build` on
 * every stop would be punitive, and typecheck is the cheap gate that catches the defect class
 * this guards. It compares mtimes rather than hashing, so a touch-without-edit costs one
 * gate run. It blocks at most once per stop sequence, so a gate that genuinely cannot pass
 * is reported to the user rather than trapping the agent. And the state file can simply be
 * deleted — this is a speed bump against carelessness, not a defense against deliberate
 * circumvention.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATE_RELATIVE_PATH = '.ai/.gate-state.json'
const WATCHED_ROOT = 'src'

export type GateName = 'typecheck' | 'lint' | 'test' | 'build' | 'generate'

export type GateRecord = { exitCode: number; finishedAt: string }

export type GateState = {
  sessionId?: string
  sessionStartedAt?: string
  gates?: Partial<Record<GateName, GateRecord>>
}

/**
 * Extracts every gate a Bash command ran.
 *
 * Returns a list because the harness's own documented gate line chains several with `&&`,
 * and a run reported through a compound command must not be invisible to the recorder.
 * Direct invocations that bypass the package script (`npx tsc --noEmit`) count too — the
 * point is whether the check happened, not which alias was typed.
 */
export function matchGates(command: string): GateName[] {
  const found = new Set<GateName>()
  const named: Array<[GateName, RegExp]> = [
    ['typecheck', /\b(?:yarn|npm run|pnpm)\s+typecheck\b|\btsc\b[^&|;]*--noEmit/],
    ['lint', /\b(?:yarn|npm run|pnpm)\s+lint\b|\beslint\b/],
    ['test', /\b(?:yarn|npm run|pnpm)\s+test\b|\bjest\b/],
    ['build', /\b(?:yarn|npm run|pnpm)\s+build\b|\bnext build\b/],
    ['generate', /\b(?:yarn|npm run|pnpm)\s+generate\b|\bmercato\s+generate\b/],
  ]
  for (const [gate, pattern] of named) {
    if (pattern.test(command)) found.add(gate)
  }
  return [...found]
}

/**
 * Decides whether a command's exit status can be attributed to the gates it names.
 *
 * A pipeline reports the exit status of its LAST stage, so `yarn typecheck | tail -30`
 * reports `tail`'s success no matter what `tsc` did. `;` and `||` break the link the same
 * way. `&&` does not: it short-circuits, so a non-zero status still belongs to a gate that
 * ran — at worst a later gate's failure is attributed to an earlier one, which only costs a
 * re-run.
 *
 * Recording an unattributable status would manufacture exactly the false green this hook
 * exists to prevent, so those commands are not recorded at all.
 */
export function isAttributableGateCommand(command: string): boolean {
  return !/[|;\n]/.test(command)
}

/**
 * Resolves the exit status a Bash tool response reported, or `null` when it reported none.
 *
 * `null` is not zero. An unknown outcome must never be stored as a pass — the whole point of
 * the state file is that it holds observed results, and a payload shape this hook does not
 * recognize is the one case where it has observed nothing.
 */
export function resolveExitCode(data: HookInput): number | null {
  const response = data.tool_response ?? {}
  const value = response.exit_code ?? response.exitCode
  return typeof value === 'number' ? value : null
}

/**
 * Rolls the state forward into the session the current invocation belongs to.
 *
 * The state file outlives the session that wrote it, so a `sessionStartedAt` set once and
 * never revisited would pin every later session to the first one's clock and make the
 * "changed during THIS session" test meaningless. A new `session_id` therefore starts from a
 * clean record: gates observed in an earlier session prove nothing about this one.
 *
 * Payloads without a `session_id` keep the original set-once behavior, so an older client
 * degrades rather than resetting on every call.
 */
export function nextSessionState(previous: GateState, sessionId: string | null, startedAt: string): GateState {
  if (!sessionId) {
    return previous.sessionStartedAt ? previous : { ...previous, sessionStartedAt: startedAt }
  }
  if (previous.sessionId === sessionId && previous.sessionStartedAt) return previous
  return { sessionId, sessionStartedAt: startedAt }
}

/**
 * Decides whether concluding should be blocked.
 *
 * An absent typecheck record does NOT block on its own — otherwise the first stop of every
 * session on a fresh clone would block, including read-only or docs-only sessions that never
 * touched `src/`. The gate is source changed during THIS session and not since verified.
 */
export function shouldBlock(input: {
  newestSrcMtimeMs: number | null
  sessionStartedAtMs: number
  lastGreenTypecheckMs: number | null
}): boolean {
  const { newestSrcMtimeMs, sessionStartedAtMs, lastGreenTypecheckMs } = input
  if (newestSrcMtimeMs === null) return false
  if (newestSrcMtimeMs < sessionStartedAtMs) return false
  if (lastGreenTypecheckMs === null) return true
  return newestSrcMtimeMs > lastGreenTypecheckMs
}

function projectDir(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd()
}

function statePath(): string {
  return join(projectDir(), STATE_RELATIVE_PATH)
}

function readState(): GateState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as GateState
  } catch {
    return {}
  }
}

function writeState(state: GateState): void {
  try {
    mkdirSync(join(projectDir(), '.ai'), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // A hook must never fail the turn over its own bookkeeping.
  }
}

function newestMtimeMs(dir: string): number | null {
  let newest: number | null = null
  const walk = (current: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(current, entry)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) walk(full)
      else if (newest === null || stats.mtimeMs > newest) newest = stats.mtimeMs
    }
  }
  walk(dir)
  return newest
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { raw += chunk })
    process.stdin.on('end', () => resolve(raw))
  })
}

export type HookInput = {
  session_id?: string
  stop_hook_active?: boolean
  tool_input?: { command?: string }
  tool_response?: { exit_code?: number; exitCode?: number }
}

async function main(): Promise<void> {
  const mode = process.argv[2] === 'check' ? 'check' : 'record'
  const raw = await readStdin()

  let data: HookInput = {}
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as HookInput
    } catch {
      return
    }
  }

  const previous = readState()
  const now = new Date()
  const state = nextSessionState(previous, data.session_id ?? null, now.toISOString())
  if (state !== previous) writeState(state)

  if (mode === 'record') {
    const command = data.tool_input?.command
    if (!command) return
    const gates = matchGates(command)
    if (!gates.length) return
    if (!isAttributableGateCommand(command)) return
    const exitCode = resolveExitCode(data)
    if (exitCode === null) return
    state.gates = state.gates ?? {}
    for (const gate of gates) {
      state.gates[gate] = { exitCode, finishedAt: now.toISOString() }
    }
    writeState(state)
    return
  }

  if (data.stop_hook_active) return

  const typecheck = state.gates?.typecheck
  const blocked = shouldBlock({
    newestSrcMtimeMs: newestMtimeMs(join(projectDir(), WATCHED_ROOT)),
    sessionStartedAtMs: Date.parse(state.sessionStartedAt ?? now.toISOString()),
    lastGreenTypecheckMs: typecheck && typecheck.exitCode === 0 ? Date.parse(typecheck.finishedAt) : null,
  })
  if (!blocked) return

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: [
      `Source under ${WATCHED_ROOT}/ changed this session and has not passed a typecheck since.`,
      '',
      'Run `yarn typecheck` and report its exit status before concluding.',
      'If it genuinely fails and you cannot fix it, report the failure to the user —',
      'do not delete .ai/.gate-state.json to work around this.',
    ].join('\n'),
  }))
}

/**
 * Run only when invoked as the hook, never on import.
 *
 * `main()` blocks reading stdin, so an unguarded top-level call makes the module impossible
 * to import — a test that pulled in `matchGates` would hang forever waiting for input that
 * never arrives.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (isEntryPoint()) void main()
