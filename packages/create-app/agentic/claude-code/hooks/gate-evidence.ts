/**
 * Record validation-gate outcomes, and refuse to conclude on unverified source changes.
 *
 * Two modes, mirroring `entity-migration-check`'s shape:
 *
 * - `record` (PostToolUse on Bash) — when a Bash command was a validation gate, append its
 *   exit status to `.ai/.gate-state.json`.
 * - `check` (Stop) — block when a file under `src/` changed after the session started and is
 *   newer than the last exit-0 typecheck.
 *
 * Why this exists: a gate that is claimed but never run is indistinguishable, in a
 * transcript, from one that passed. This makes the difference mechanical.
 *
 * Deliberate limits. The blocker only considers `typecheck`: demanding a green `build` on
 * every stop would be punitive, and typecheck is the cheap gate that catches the defect class
 * this guards. It compares mtimes rather than hashing, so a touch-without-edit costs one
 * gate run. And the state file can simply be deleted — this is a speed bump against
 * carelessness, not a defense against deliberate circumvention.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATE_RELATIVE_PATH = '.ai/.gate-state.json'
const WATCHED_ROOT = 'src'

export type GateName = 'typecheck' | 'lint' | 'test' | 'build' | 'generate'

export type GateRecord = { exitCode: number; finishedAt: string }

export type GateState = {
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

type HookInput = {
  tool_input?: { command?: string }
  tool_response?: { exit_code?: number; exitCode?: number }
}

function resolveExitCode(data: HookInput): number {
  const response = data.tool_response ?? {}
  const value = response.exit_code ?? response.exitCode
  return typeof value === 'number' ? value : 0
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

  const state = readState()
  const now = new Date()
  if (!state.sessionStartedAt) {
    state.sessionStartedAt = now.toISOString()
    writeState(state)
  }

  if (mode === 'record') {
    const command = data.tool_input?.command
    if (!command) return
    const gates = matchGates(command)
    if (!gates.length) return
    const exitCode = resolveExitCode(data)
    state.gates = state.gates ?? {}
    for (const gate of gates) {
      state.gates[gate] = { exitCode, finishedAt: now.toISOString() }
    }
    writeState(state)
    return
  }

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
