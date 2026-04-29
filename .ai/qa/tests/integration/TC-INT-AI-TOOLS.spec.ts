import { spawn } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * TC-INT-AI-TOOLS: Smoke-test every AI tool registered via `defineAiTool`.
 *
 * Strategy: shells out to `yarn mercato ai_assistant test-tools --json` which
 * runs the in-process tool runner (`packages/ai-assistant/.../lib/tool-test-runner.ts`).
 * The runner iterates every entry in `apps/mercato/.mercato/generated/ai-tools.generated.ts`,
 * invokes each handler with a small fixture input against a super-admin
 * context, and returns a structured report. Mutation tools are exercised
 * through `prepareMutation` only — the test asserts a pending-action envelope
 * is returned and never confirms the action.
 *
 * No HTTP endpoint is added; the runner is CLI-only and never exposed.
 */

interface ToolTestRecord {
  module: string
  tool: string
  isMutation: boolean
  status: 'pass' | 'fail' | 'skip'
  durationMs: number
  reason?: string
}

interface ToolTestReport {
  tenantId: string | null
  organizationId: string | null
  total: number
  passed: number
  failed: number
  skipped: number
  records: ToolTestRecord[]
}

const REPORT_BEGIN = '---TOOL_TEST_REPORT_BEGIN---'
const REPORT_END = '---TOOL_TEST_REPORT_END---'

function findRepoRoot(): string {
  // .ai/qa/tests/integration → go up four levels to hit the repo root.
  return path.resolve(__dirname, '..', '..', '..', '..')
}

function findAppRoot(): string {
  // The CLI loads its env from apps/mercato/.env (DB connection, JWT secret,
  // encryption fallback). Spawning from there makes the bootstrap reach a
  // ready state instead of bailing on the MFA-secret precondition.
  return path.join(findRepoRoot(), 'apps', 'mercato')
}

function runToolTestsCli(): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveCmd, rejectCmd) => {
    const cwd = findAppRoot()
    const child = spawn(
      'yarn',
      ['mercato', 'ai_assistant', 'test-tools', '--json'],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
        shell: false,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => rejectCmd(err))
    child.on('close', (code) => {
      resolveCmd({ stdout, stderr, code: code ?? -1 })
    })
  })
}

function parseReport(stdout: string): ToolTestReport {
  const beginIdx = stdout.indexOf(REPORT_BEGIN)
  const endIdx = stdout.indexOf(REPORT_END)
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error(
      `Could not find report markers in CLI output. stdout (first 500 chars):\n${stdout.slice(0, 500)}`,
    )
  }
  const payload = stdout.slice(beginIdx + REPORT_BEGIN.length, endIdx).trim()
  return JSON.parse(payload) as ToolTestReport
}

test.describe('TC-INT-AI-TOOLS: Every AI tool returns the expected shape', () => {
  test('all registered tools either pass or skip with a reason; none fail', async () => {
    test.slow()
    const { stdout, stderr, code } = await runToolTestsCli()
    if (code !== 0 && stdout.indexOf(REPORT_BEGIN) === -1) {
      throw new Error(
        `tool-test CLI failed (exit ${code}) before producing a report.\nstderr:\n${stderr.slice(0, 2000)}\nstdout:\n${stdout.slice(0, 1000)}`,
      )
    }
    const report = parseReport(stdout)

    // Surface a compact summary in the test log for triage.
    const failures = report.records.filter((r) => r.status === 'fail')
    const skips = report.records.filter((r) => r.status === 'skip')
    if (failures.length > 0) {
      console.log(
        `[TC-INT-AI-TOOLS] Failures (${failures.length}):\n${failures
          .map((r) => `  - ${r.tool}: ${r.reason ?? '<no reason>'}`)
          .join('\n')}`,
      )
    }
    if (skips.length > 0) {
      console.log(
        `[TC-INT-AI-TOOLS] Skips (${skips.length}): ${skips
          .map((r) => `${r.tool} (${r.reason ?? 'skipped'})`)
          .join(', ')}`,
      )
    }
    console.log(
      `[TC-INT-AI-TOOLS] Result: total=${report.total} pass=${report.passed} fail=${report.failed} skip=${report.skipped}`,
    )

    expect(failures, `Expected zero failing AI tools, got ${failures.length}`).toEqual([])
    expect(report.passed, 'At least one tool must run successfully').toBeGreaterThan(0)
  })
})
