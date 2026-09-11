/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  PROCESS_MILESTONES_MAX,
  processDefinitionCreateSchema,
  processMilestoneSchema,
  processMilestoneReachedSchema,
  processMilestonesSchema,
  type ProcessMilestone,
  type ProcessMilestoneReached,
} from '../data/validators'
import {
  appendMilestoneReached,
  buildMilestoneStages,
  collectMilestoneIssues,
  moveMilestone,
  orderedMilestones,
  parseMilestonesReached,
  parseProcessMilestones,
  withSequentialOrder,
} from '../lib/tasks/milestones'
import { readSquashMigrationSql } from './helpers/squashMigration'

const MODULE_ROOT = path.join(__dirname, '..')
const LOCALES = ['en', 'es', 'de', 'pl', 'ko'] as const

/**
 * Milestones as BUSINESS EVENTS
 * (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §6).
 *
 * The predecessor model bound each milestone to one `stepId`, which made "the
 * stage reached after the parallel join" unexpressible and let a step rename
 * silently break the mapping. The definition now declares a VOCABULARY, the
 * workflow announces a key when a step carrying it completes, and the execution
 * records what was announced.
 */

const WORKFLOW_BASE = {
  name: 'Case intake',
  workflowMode: 'workflow' as const,
  workflowId: 'claims.intake',
}

const SINGLE_AGENT_BASE = {
  name: 'Lead triage',
  workflowMode: 'single_agent' as const,
  singleAgent: { agentId: 'deals.lead_triage', onResult: { alwaysAsk: true as const } },
}

function milestone(overrides: Partial<ProcessMilestone> = {}): ProcessMilestone {
  return { key: 'case_assessed', label: 'Case assessed', order: 0, ...overrides }
}

function reached(key: string, at = '2026-09-06T10:00:00.000Z'): ProcessMilestoneReached {
  return { key, at }
}

describe('processMilestoneSchema', () => {
  it('round-trips the stored shape', () => {
    const stored = milestone({ key: 'payout_approved', label: 'Payout approved', order: 3 })
    expect(processMilestoneSchema.parse(stored)).toEqual(stored)
  })

  it('carries NO stepId — a milestone is not an alias for a step', () => {
    const parsed = processMilestoneSchema.parse({ ...milestone(), stepId: 'assess_claim' })
    expect('stepId' in parsed).toBe(false)
  })

  it('requires every field — a milestone with no label has nothing to show a reader', () => {
    expect(processMilestoneSchema.safeParse({ key: 'case_assessed', order: 0 }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), label: '' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), key: '' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), order: -1 }).success).toBe(false)
  })

  it('bounds the key to the vocabulary a workflow step can name', () => {
    expect(processMilestoneSchema.safeParse({ ...milestone(), key: 'Case Assessed' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), key: 'case-assessed' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), key: 'case_assessed_2' }).success).toBe(true)
  })

  it('bounds the list at 50 entries', () => {
    const full = Array.from({ length: PROCESS_MILESTONES_MAX }, (_, index) =>
      milestone({ key: `stage_${index}`, order: index }),
    )
    expect(processMilestonesSchema.safeParse(full).success).toBe(true)
    expect(processMilestonesSchema.safeParse([...full, milestone({ key: 'one_too_many' })]).success).toBe(false)
  })

  it('rejects a duplicate key — two stages sharing one collapse into one row', () => {
    const duplicated = [milestone({ key: 'assessed', order: 0 }), milestone({ key: 'assessed', order: 1 })]
    expect(processMilestonesSchema.safeParse(duplicated).success).toBe(false)
  })
})

describe('milestones are declarable in BOTH modes', () => {
  // The predecessor model refused them on an agent target because it had no
  // steps to map onto. Nothing maps onto a step any more, so the restriction had
  // no reason to survive: a single-agent process announces stages too.
  const milestones = [milestone()]

  it('accepts them on a workflow-backed process', () => {
    expect(processDefinitionCreateSchema.safeParse({ ...WORKFLOW_BASE, milestones }).success).toBe(true)
  })

  it('accepts them on a single-agent process', () => {
    expect(processDefinitionCreateSchema.safeParse({ ...SINGLE_AGENT_BASE, milestones }).success).toBe(true)
  })
})

describe('parseProcessMilestones', () => {
  it('drops unparseable entries rather than throwing', () => {
    const parsed = parseProcessMilestones([milestone(), { key: 'x' }, 'nonsense'])
    expect(parsed).toEqual([milestone()])
  })

  it('reads a non-array column as an empty list', () => {
    expect(parseProcessMilestones(null)).toEqual([])
    expect(parseProcessMilestones({ key: 'x' })).toEqual([])
  })
})

describe('ordering helpers', () => {
  const list = [
    milestone({ key: 'decided', label: 'Decided', order: 2 }),
    milestone({ key: 'reported', label: 'Reported', order: 0 }),
    milestone({ key: 'assessed', label: 'Assessed', order: 1 }),
  ]

  it('orders by the stored rank', () => {
    expect(orderedMilestones(list).map((one) => one.key)).toEqual(['reported', 'assessed', 'decided'])
  })

  it('renumbers to array position so a saved list carries no gaps', () => {
    expect(withSequentialOrder(list).map((one) => one.order)).toEqual([0, 1, 2])
  })

  it('moves and renumbers; an out-of-range index is a no-op', () => {
    expect(moveMilestone(orderedMilestones(list), 0, 2).map((one) => one.key)).toEqual([
      'assessed',
      'decided',
      'reported',
    ])
    expect(moveMilestone(list, 0, 9)).toBe(list)
    expect(moveMilestone(list, -1, 0)).toBe(list)
  })
})

describe('the reached list', () => {
  it('round-trips the stored shape and tolerates junk', () => {
    expect(processMilestoneReachedSchema.parse(reached('assessed'))).toEqual(reached('assessed'))
    expect(parseMilestonesReached([reached('assessed'), { key: 'no_timestamp' }])).toEqual([
      reached('assessed'),
    ])
    expect(parseMilestonesReached(null)).toEqual([])
  })

  it('is idempotent per key — a retried step must not make the narrative stutter', () => {
    const first = appendMilestoneReached([], reached('assessed', '2026-09-06T10:00:00.000Z'))
    const again = appendMilestoneReached(first, reached('assessed', '2026-09-06T11:00:00.000Z'))
    expect(again).toBe(first)
    expect(again).toHaveLength(1)
    // The FIRST arrival wins: when a stage was reached is a fact about the
    // execution, not about how many times the event was redelivered.
    expect(again[0].at).toBe('2026-09-06T10:00:00.000Z')
  })

  it('appends a genuinely new key in emission order', () => {
    const list = appendMilestoneReached(appendMilestoneReached([], reached('assessed')), reached('decided'))
    expect(list.map((one) => one.key)).toEqual(['assessed', 'decided'])
  })
})

describe('collectMilestoneIssues', () => {
  const declared = [milestone({ key: 'assessed', label: 'Assessed', order: 0 })]

  it('warns about a declared key no step emits — a stage that can never arrive', () => {
    const issues = collectMilestoneIssues({ milestones: declared, emittedKeys: new Set(['decided']) })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].message).toContain('Assessed')
    expect(issues[0].message).toContain('assessed')
  })

  it('reports nothing when the workflow emits the key', () => {
    expect(collectMilestoneIssues({ milestones: declared, emittedKeys: new Set(['assessed']) })).toEqual([])
  })

  it('reports NOTHING when the workflow could not be resolved — unknown is not missing', () => {
    expect(collectMilestoneIssues({ milestones: declared, emittedKeys: null })).toEqual([])
  })

  it('never escalates past a warning — a definition mid-edit must stay saveable', () => {
    const issues = collectMilestoneIssues({ milestones: declared, emittedKeys: new Set<string>() })
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })
})

describe('buildMilestoneStages', () => {
  const list = [
    milestone({ key: 'reported', label: 'Reported', order: 0 }),
    milestone({ key: 'assessed', label: 'Assessed', order: 1 }),
    milestone({ key: 'decided', label: 'Decided', order: 2 }),
  ]

  it('marks every announced stage done, whichever order they arrived in', () => {
    const stages = buildMilestoneStages(list, [reached('assessed'), reached('reported')])
    expect(stages.map((one) => one.state)).toEqual(['done', 'done', 'current'])
    expect(stages[0].at).toBe('2026-09-06T10:00:00.000Z')
  })

  it('leaves everything upcoming when the execution has announced nothing', () => {
    expect(buildMilestoneStages(list, []).every((one) => one.state === 'upcoming')).toBe(true)
  })

  it('marks no stage current once the execution is terminal', () => {
    const stages = buildMilestoneStages(list, [reached('reported')], { terminal: true })
    expect(stages.map((one) => one.state)).toEqual(['done', 'upcoming', 'upcoming'])
  })

  it('is not confused by a stage the workflow announced but nobody declared', () => {
    const stages = buildMilestoneStages(list, [reached('reported'), reached('never_declared')])
    expect(stages.map((one) => one.key)).toEqual(['reported', 'assessed', 'decided'])
  })
})

describe('the squashed migration', () => {
  const migration = readSquashMigrationSql()

  it('creates the vocabulary column on the definition and the reached list on the execution', () => {
    expect(migration).toContain(`"milestones" jsonb null default '[]'`)
    expect(migration).toContain(`"milestones_reached" jsonb null default '[]'`)
  })

  it('ships the regenerated snapshot alongside it', () => {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'migrations', '.snapshot-open-mercato.json'), 'utf8'),
    ) as { tables: Array<{ name: string; columns: Record<string, { type: string; default: string | null }> }> }
    const definitions = snapshot.tables.find((one) => one.name === 'process_definitions')
    expect(definitions?.columns.milestones?.type).toBe('jsonb')
    expect(definitions?.columns.milestones?.default).toBe(`'[]'`)
    const instances = snapshot.tables.find((one) => one.name === 'process_instances')
    expect(instances?.columns.milestones_reached?.type).toBe('jsonb')
  })
})

describe('i18n coverage for the milestone editor', () => {
  const requiredKeys = [
    'agent_orchestrator.process.milestonesTitle',
    'agent_orchestrator.process.stagesObservedTitle',
    'agent_orchestrator.processDefinitions.milestones.add',
    'agent_orchestrator.processDefinitions.milestones.cap',
    'agent_orchestrator.processDefinitions.milestones.description',
    'agent_orchestrator.processDefinitions.milestones.empty',
    'agent_orchestrator.processDefinitions.milestones.error',
    'agent_orchestrator.processDefinitions.milestones.key',
    'agent_orchestrator.processDefinitions.milestones.keyPlaceholder',
    'agent_orchestrator.processDefinitions.milestones.label',
    'agent_orchestrator.processDefinitions.milestones.labelPlaceholder',
    'agent_orchestrator.processDefinitions.milestones.moveDown',
    'agent_orchestrator.processDefinitions.milestones.moveUp',
    'agent_orchestrator.processDefinitions.milestones.problems.neverEmitted',
    'agent_orchestrator.processDefinitions.milestones.problems.rowHint',
    'agent_orchestrator.processDefinitions.milestones.problems.stillSaveable',
    'agent_orchestrator.processDefinitions.milestones.problems.title',
    'agent_orchestrator.processDefinitions.milestones.remove',
    'agent_orchestrator.processDefinitions.milestones.save',
    'agent_orchestrator.processDefinitions.milestones.saved',
    'agent_orchestrator.processDefinitions.milestones.emittedLoading',
    'agent_orchestrator.processDefinitions.milestones.emittedUnresolved',
    'agent_orchestrator.processDefinitions.milestones.title',
  ]

  it.each(LOCALES)('%s carries every milestone key with interpolation tokens intact', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of requiredKeys) {
      expect(catalog[key]).toBeTruthy()
    }
    expect(catalog['agent_orchestrator.processDefinitions.milestones.cap']).toContain('{max}')
    const neverEmitted = catalog['agent_orchestrator.processDefinitions.milestones.problems.neverEmitted']
    expect(neverEmitted).toContain('{label}')
    expect(neverEmitted).toContain('{key}')
  })
})
