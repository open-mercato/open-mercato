/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  PROCESS_MILESTONES_MAX,
  agentProcessDefinitionCreateSchema,
  agentProcessDefinitionUpdateSchema,
  processMilestoneSchema,
  processMilestonesSchema,
  type ProcessMilestone,
} from '../data/validators'
import {
  buildMilestoneStages,
  collectMilestoneIssues,
  moveMilestone,
  orderedMilestones,
  parseProcessMilestones,
  withSequentialOrder,
} from '../lib/tasks/milestones'

const MODULE_ROOT = path.join(__dirname, '..')
const LOCALES = ['en', 'es', 'de', 'pl', 'ko'] as const

/**
 * Phase 3 of the triggered process model — the authored, ordered business
 * stages of a process, plus the drift diagnostic that keeps their step mapping
 * honest (`.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`).
 */

const WORKFLOW_BASE = {
  name: 'Case intake',
  targetType: 'workflow' as const,
  targetWorkflowId: 'claims.intake',
}

const AGENT_BASE = {
  name: 'Lead triage',
  targetType: 'agent' as const,
  targetAgentId: 'deals.lead_triage',
}

function milestone(overrides: Partial<ProcessMilestone> = {}): ProcessMilestone {
  return { id: 'ms-1', label: 'Case assessed', stepId: 'assess_claim', order: 0, ...overrides }
}

describe('processMilestoneSchema', () => {
  it('round-trips the stored shape', () => {
    const stored = milestone({ id: 'ms-7', label: 'Payout approved', stepId: 'approve_payout', order: 3 })
    expect(processMilestoneSchema.parse(stored)).toEqual(stored)
  })

  it('requires every field — a milestone with no label has nothing to show a reader', () => {
    expect(processMilestoneSchema.safeParse({ id: 'ms-1', stepId: 'assess_claim', order: 0 }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), label: '' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), stepId: '' }).success).toBe(false)
    expect(processMilestoneSchema.safeParse({ ...milestone(), order: -1 }).success).toBe(false)
  })

  it('bounds the list at 50 entries', () => {
    const full = Array.from({ length: PROCESS_MILESTONES_MAX }, (_, index) =>
      milestone({ id: `ms-${index}`, stepId: `step_${index}`, order: index }),
    )
    expect(processMilestonesSchema.safeParse(full).success).toBe(true)
    const overflow = [...full, milestone({ id: 'ms-overflow', stepId: 'step_overflow', order: 50 })]
    expect(processMilestonesSchema.safeParse(overflow).success).toBe(false)
  })

  it('rejects two milestones sharing an id', () => {
    const clash = [milestone(), milestone({ label: 'Payout approved', stepId: 'approve_payout', order: 1 })]
    const result = processMilestonesSchema.safeParse(clash)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([1, 'id'])
  })
})

describe('milestones apply to workflow targets only', () => {
  it('rejects milestones on an agent-targeted definition — a validation error, not a silent no-op', () => {
    const create = agentProcessDefinitionCreateSchema.safeParse({ ...AGENT_BASE, milestones: [milestone()] })
    expect(create.success).toBe(false)
    if (!create.success) expect(create.error.issues[0]?.path).toEqual(['milestones'])

    const update = agentProcessDefinitionUpdateSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      ...AGENT_BASE,
      milestones: [milestone()],
    })
    expect(update.success).toBe(false)
    if (!update.success) expect(update.error.issues[0]?.path).toEqual(['milestones'])
  })

  it('accepts an EMPTY list on an agent target — the absence is not an error', () => {
    expect(agentProcessDefinitionCreateSchema.safeParse({ ...AGENT_BASE, milestones: [] }).success).toBe(true)
    expect(agentProcessDefinitionCreateSchema.safeParse(AGENT_BASE).success).toBe(true)
  })

  it('accepts milestones on a workflow target', () => {
    expect(
      agentProcessDefinitionCreateSchema.safeParse({ ...WORKFLOW_BASE, milestones: [milestone()] }).success,
    ).toBe(true)
  })
})

describe('the drift diagnostic', () => {
  const declared = new Set(['assess_claim', 'approve_payout'])

  it('warns on a milestone naming a step the workflow no longer declares — and it stays SAVEABLE', () => {
    const milestones = [
      milestone(),
      milestone({ id: 'ms-2', label: 'Fraud reviewed', stepId: 'review_fraud', order: 1 }),
    ]
    const issues = collectMilestoneIssues({ milestones, knownStepIds: declared })
    expect(issues).toHaveLength(1)
    // A warning, never an error: a definition mid-edit must stay saveable.
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].nodeId).toBe('review_fraud')
    expect(issues[0].message).toContain('review_fraud')
    expect(issues[0].message).toContain('Fraud reviewed')

    // ...and the same definition still validates, so the save is never blocked.
    expect(
      agentProcessDefinitionCreateSchema.safeParse({ ...WORKFLOW_BASE, milestones }).success,
    ).toBe(true)
  })

  it('reports nothing when every milestone maps to a declared step', () => {
    const milestones = [
      milestone(),
      milestone({ id: 'ms-2', label: 'Payout approved', stepId: 'approve_payout', order: 1 }),
    ]
    expect(collectMilestoneIssues({ milestones, knownStepIds: declared })).toEqual([])
  })

  it('stays silent when the step list could not be resolved — "unknown" is not "missing"', () => {
    expect(
      collectMilestoneIssues({ milestones: [milestone({ stepId: 'gone' })], knownStepIds: null }),
    ).toEqual([])
  })

  it('routes its message through the same key+fallback seam core workflows uses', () => {
    const issues = collectMilestoneIssues({
      milestones: [milestone({ stepId: 'gone' })],
      knownStepIds: declared,
      translate: (key, _fallback, params) => `${key}|${params.stepId}`,
    })
    expect(issues[0].message).toBe(
      'agent_orchestrator.processDefinitions.milestones.problems.unknownStep|gone',
    )
  })
})

describe('milestone readers', () => {
  it('parses the stored column tolerantly and drops unusable entries', () => {
    const parsed = parseProcessMilestones([milestone(), { id: 'broken' }, null, 'nope'])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].stepId).toBe('assess_claim')
    expect(parseProcessMilestones(null)).toEqual([])
    expect(parseProcessMilestones(undefined)).toEqual([])
  })

  it('orders by the authored order, not by array position', () => {
    const shuffled = [
      milestone({ id: 'c', label: 'Third', stepId: 'third', order: 2 }),
      milestone({ id: 'a', label: 'First', stepId: 'first', order: 0 }),
      milestone({ id: 'b', label: 'Second', stepId: 'second', order: 1 }),
    ]
    expect(orderedMilestones(shuffled).map((one) => one.label)).toEqual(['First', 'Second', 'Third'])
  })

  it('renumbers on reorder so a saved list can never carry gaps or ties', () => {
    const list = [
      milestone({ id: 'a', label: 'First', stepId: 'first', order: 0 }),
      milestone({ id: 'b', label: 'Second', stepId: 'second', order: 1 }),
      milestone({ id: 'c', label: 'Third', stepId: 'third', order: 2 }),
    ]
    const moved = moveMilestone(list, 2, 0)
    expect(moved.map((one) => one.id)).toEqual(['c', 'a', 'b'])
    expect(moved.map((one) => one.order)).toEqual([0, 1, 2])
    expect(moveMilestone(list, 0, 0)).toBe(list)
    expect(moveMilestone(list, 0, 5)).toBe(list)
    expect(withSequentialOrder([milestone({ order: 9 })])[0].order).toBe(0)
  })

  it('builds the business stage list with the run resolved to one of its own stages', () => {
    const list = [
      milestone({ id: 'a', label: 'Reported', stepId: 'report', order: 0 }),
      milestone({ id: 'b', label: 'Assessed', stepId: 'assess_claim', order: 1 }),
      milestone({ id: 'c', label: 'Paid', stepId: 'pay', order: 2 }),
    ]
    expect(buildMilestoneStages(list, 'assess_claim').map((stage) => stage.state)).toEqual([
      'done',
      'current',
      'upcoming',
    ])
    // A terminal process shows no phantom "current" stage.
    expect(buildMilestoneStages(list, 'assess_claim', { terminal: true }).every((s) => s.state === 'done')).toBe(true)
    // A step no milestone names never guesses a position.
    expect(buildMilestoneStages(list, 'unmapped_step').every((s) => s.state === 'upcoming')).toBe(true)
    expect(buildMilestoneStages(list, 'report')[0].label).toBe('Reported')
  })
})

describe('the Phase 3 migration', () => {
  const migrationsDir = path.join(MODULE_ROOT, 'migrations')
  const migration = fs.readFileSync(
    path.join(migrationsDir, 'Migration20260811170000_agent_orchestrator.ts'),
    'utf8',
  )

  it('adds the column with the specified jsonb default', () => {
    expect(migration).toContain(
      `alter table "agent_process_definitions" add "milestones" jsonb null default '[]';`,
    )
    expect(migration).toContain(`alter table "agent_process_definitions" drop column "milestones";`)
  })

  it('is its OWN file — the two committed migrations are untouched', () => {
    for (const committed of [
      'Migration20260811150000_agent_orchestrator.ts',
      'Migration20260811160000_agent_orchestrator.ts',
    ]) {
      expect(fs.readFileSync(path.join(migrationsDir, committed), 'utf8')).not.toContain('milestones')
    }
  })

  it('ships the regenerated snapshot alongside it', () => {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, '.snapshot-open-mercato.json'), 'utf8'),
    ) as { tables: Array<{ name: string; columns: Record<string, { type: string; default: string | null }> }> }
    const table = snapshot.tables.find((one) => one.name === 'agent_process_definitions')
    expect(table?.columns.milestones?.type).toBe('jsonb')
    expect(table?.columns.milestones?.default).toBe(`'[]'`)
  })
})

describe('i18n coverage for the milestone editor', () => {
  const requiredKeys = [
    'agent_orchestrator.process.milestonesTitle',
    'agent_orchestrator.process.stagesObservedTitle',
    'agent_orchestrator.processDefinitions.form.errors.milestonesAgentTarget',
    'agent_orchestrator.processDefinitions.milestones.add',
    'agent_orchestrator.processDefinitions.milestones.agentTargetHint',
    'agent_orchestrator.processDefinitions.milestones.cap',
    'agent_orchestrator.processDefinitions.milestones.description',
    'agent_orchestrator.processDefinitions.milestones.empty',
    'agent_orchestrator.processDefinitions.milestones.error',
    'agent_orchestrator.processDefinitions.milestones.label',
    'agent_orchestrator.processDefinitions.milestones.labelPlaceholder',
    'agent_orchestrator.processDefinitions.milestones.moveDown',
    'agent_orchestrator.processDefinitions.milestones.moveUp',
    'agent_orchestrator.processDefinitions.milestones.problems.rowHint',
    'agent_orchestrator.processDefinitions.milestones.problems.stillSaveable',
    'agent_orchestrator.processDefinitions.milestones.problems.title',
    'agent_orchestrator.processDefinitions.milestones.problems.unknownStep',
    'agent_orchestrator.processDefinitions.milestones.remove',
    'agent_orchestrator.processDefinitions.milestones.save',
    'agent_orchestrator.processDefinitions.milestones.saved',
    'agent_orchestrator.processDefinitions.milestones.step',
    'agent_orchestrator.processDefinitions.milestones.stepPlaceholder',
    'agent_orchestrator.processDefinitions.milestones.stepsLoading',
    'agent_orchestrator.processDefinitions.milestones.stepsUnresolved',
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
    const unknownStep = catalog['agent_orchestrator.processDefinitions.milestones.problems.unknownStep']
    expect(unknownStep).toContain('{label}')
    expect(unknownStep).toContain('{stepId}')
  })
})
