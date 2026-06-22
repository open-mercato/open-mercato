/**
 * Phase 5 — sandboxed execution of agent-local skill scripts and local tool
 * files.
 *
 * Security is the headline: a file-agent script/tool must NEVER touch fs/net,
 * mutate domain state, or escape the sandbox. We REUSE the Code Mode sandbox
 * (`createSandbox` from `@open-mercato/ai-assistant`, backed by `isolated-vm`)
 * rather than hand-rolling a new one. That sandbox gives, per execution:
 *
 *  - a FRESH V8 isolate with no shared prototype chain / heap / handle access to
 *    the host process (closes the `node:vm` Promise-prototype escape);
 *  - NO Node globals: `require`, `process`, `fs`, `Buffer`, `fetch`, network APIs,
 *    and `globalThis` itself are all absent/shadowed — only the globals we inject
 *    (`__args` + a console proxy) exist inside the isolate;
 *  - a hard wall-clock timeout (default 30_000ms — the spec's 30s cap; we never
 *    raise it) enforced by a `Promise.race` that rejects + disposes the isolate;
 *  - a 32MB memory cap (`SANDBOX_MEMORY_MB`).
 *
 * Per-call ACL is enforced one layer up by the MCP tool's `requiredFeatures`
 * (`agent_orchestrator.agents.run`) + the per-run session token, so this module
 * only owns the execution-isolation guarantee.
 *
 * Trust model: the script SOURCE is trusted, committed, in-repo manifest content
 * (`run_skill_script` only lets the model pick WHICH named script runs, never
 * supply source), and the security boundary is the V8 isolate above — NOT the way
 * the source string is wrapped below. `wrapScript` is a correctness device (so the
 * `run` binding is in scope and actually invoked), not a sanitization device.
 *
 * Invocation convention: a script/tool source file MUST define a function named
 * `run` (a `function run(args) {…}` declaration OR a `const run = (args) => …`
 * binding). We wrap the whole source in a single async arrow whose body defines
 * `run` and then awaits `run(__args)`, returning its value. A source that defines
 * no `run` is a usage error returned as data (never thrown across the isolate
 * boundary). The script may NOT import anything (no `require`/`import` exist in
 * the isolate); it is a pure function of `args`.
 */

import { createSandbox } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/sandbox'

/** The strict 30s cap from spec §7.5. Never raised. */
export const SKILL_SCRIPT_TIMEOUT_MS = 30_000

export type RunSandboxedScriptResult =
  | { ok: true; result: unknown }
  | { ok: false; code: 'script_error' | 'no_run_export'; error: string }

/**
 * Wrap a script source in a single async arrow so `createSandbox().execute`
 * (which compiles `(normalizeCode(code))()` and passes through any code that
 * already starts with `async (`) runs it directly. The body defines `run` then
 * calls it; a missing `run` returns the `no_run_export` sentinel (a normal value
 * the host maps to an error, not an isolate throw). `__args` is the injected
 * args global. Building it as ONE arrow (rather than appending a trailing arrow
 * to the raw source) is required: `normalizeCode` auto-wraps any source that does
 * NOT start with `async (`, which would otherwise bury a trailing trampoline
 * inside a wrapper and never invoke it.
 */
function wrapScript(source: string): string {
  return [
    'async () => {',
    source,
    ';',
    "if (typeof run !== 'function') { return { __omScriptError: 'no_run_export' } }",
    'return { __omScriptResult: await run(__args) }',
    '}',
  ].join('\n')
}

/**
 * Execute a skill script / local tool source string in the Code Mode sandbox.
 *
 * The `args` value is injected as the `__args` global (structured-clone copied
 * into the isolate). The script's `run(args)` return value is copied back out.
 * fs/net/require are unavailable inside the isolate, so a script that tries them
 * fails with a `ReferenceError` surfaced as `{ ok:false, code:'script_error' }`.
 * An infinite loop is killed by the timeout and surfaced the same way.
 */
export async function runSandboxedScript(input: {
  source: string
  args: unknown
}): Promise<RunSandboxedScriptResult> {
  const sandbox = createSandbox(
    { __args: input.args ?? null },
    { timeout: SKILL_SCRIPT_TIMEOUT_MS },
  )
  const outcome = await sandbox.execute(wrapScript(input.source))
  if (outcome.error) {
    return { ok: false, code: 'script_error', error: outcome.error }
  }
  const value = outcome.result as
    | { __omScriptResult: unknown }
    | { __omScriptError: 'no_run_export' }
    | null
  if (value && typeof value === 'object' && '__omScriptError' in value) {
    return {
      ok: false,
      code: 'no_run_export',
      error: 'script must define a `run(args)` function',
    }
  }
  if (value && typeof value === 'object' && '__omScriptResult' in value) {
    return { ok: true, result: value.__omScriptResult }
  }
  // Defensive: an unexpected shape (should not happen) is a script error.
  return { ok: false, code: 'script_error', error: 'script produced no result' }
}
