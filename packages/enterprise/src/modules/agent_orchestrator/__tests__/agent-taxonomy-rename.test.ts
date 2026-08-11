import { describe, test, expect } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The `informative` → `researcher` rename (spec
 * `.ai/specs/enterprise/agent-orchestrator/2026-08-11-agent-taxonomy.md`, Phase 3
 * step 10) and the graph-edge migration that carries persisted data across it.
 *
 * Two things are guarded here, and they are guarded together because they fail
 * together: a source that still speaks the old word, and stored data that still
 * carries it. Either one on its own leaves a canvas silently routing nowhere.
 */

const MODULE_DIR = path.join(__dirname, '..')
const REPO_ROOT = path.join(MODULE_DIR, '..', '..', '..', '..', '..')
const WORKFLOWS_DIR = path.join(REPO_ROOT, 'packages', 'core', 'src', 'modules', 'workflows')

/** Quoted forms only: the wire values. Prose in a comment is not a contract. */
const RETIRED_WIRE_VALUES = [
  "'informative'",
  '"informative"',
  "'actionable'",
  '"actionable"',
  'outcome:informative',
]

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx'])
/**
 * `migrations/` is EXEMPT: a migration's whole job is to name the value it is
 * rewriting away, in both directions. So is `i18n/`, which holds prose.
 */
const EXEMPT_SEGMENTS = ['/migrations/', '/i18n/', '/dist/', '/node_modules/']
/**
 * The two files that must NAME the retired values to assert they are gone: this guard
 * itself, and the schema test proving `agentTypeSchema` rejects them.
 */
const EXEMPT_FILES = ['agent-taxonomy-rename.test.ts', 'agent-taxonomy.test.ts']

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, found)
      continue
    }
    if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue
    if (EXEMPT_SEGMENTS.some((segment) => full.includes(segment))) continue
    if (EXEMPT_FILES.includes(entry.name)) continue
    found.push(full)
  }
  return found
}

function offendingLines(dir: string): string[] {
  return walk(dir).flatMap((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, index) =>
      RETIRED_WIRE_VALUES.some((value) => line.includes(value))
        ? [`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`]
        : [],
    )
  })
}

describe('no retired wire value survives the rename', () => {
  test('agent_orchestrator speaks only researcher/proposal', () => {
    expect(offendingLines(MODULE_DIR)).toEqual([])
  })

  test('core workflows speaks only researcher/proposal', () => {
    // The rename crosses into core: `AGENT_OUTCOME_KINDS`, the disposition envelope and
    // the INVOKE_AGENT result-kind vocabulary all live there.
    expect(fs.existsSync(WORKFLOWS_DIR)).toBe(true)
    expect(offendingLines(WORKFLOWS_DIR)).toEqual([])
  })
})

describe('the graph-edge migration', () => {
  const sql = fs.readFileSync(
    path.join(MODULE_DIR, 'migrations', 'Migration20260811120000_agent_orchestrator.ts'),
    'utf8',
  )

  test('adds the nullable agent_type column', () => {
    expect(sql).toContain('"agent_type" varchar(20) null')
  })

  test('moves persisted result_kind values onto the new union', () => {
    expect(sql).toContain(`set "result_kind" = 'researcher' where "result_kind" = 'informative'`)
    expect(sql).toContain(`set "result_kind" = 'proposal' where "result_kind" = 'actionable'`)
  })

  test('rewrites the outcome kind AND the outcome: handle id, in both definition tables', () => {
    // The transition stores `outcomeKind`; the canvas binds it to an `outcome:<kind>`
    // source handle. Either can carry the old string into a stored definition, so both
    // are rewritten — a definition left claiming `informative` resolves to no kind at
    // all and the run falls through to the node's error directive.
    expect(sql).toContain(`'"outcomeKind": "informative"'`)
    expect(sql).toContain(`'"outcomeKind": "researcher"'`)
    expect(sql).toContain(`'"outcome:informative"'`)
    expect(sql).toContain(`'"outcome:researcher"'`)
    expect(sql).toContain('workflow_definitions')
    expect(sql).toContain('workflow_definition_drafts')
  })

  test('guards its reach into core tables with to_regclass, like Migration20260811090000', () => {
    expect(sql).toContain(`to_regclass('public.\${table}')`)
  })

  test('is reversible in both halves', () => {
    const down = sql.slice(sql.indexOf('override down()'))
    expect(down).toContain('drop column "agent_type"')
    expect(down).toContain(`'"outcomeKind": "informative"'`)
    expect(down).toContain(`set "result_kind" = 'informative' where "result_kind" = 'researcher'`)
  })
})
