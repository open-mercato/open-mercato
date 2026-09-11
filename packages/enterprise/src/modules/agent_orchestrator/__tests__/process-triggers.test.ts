/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { readSquashMigrationSql } from './helpers/squashMigration'
import {
  PROCESS_TRIGGERS_MAX,
  processDefinitionCreateSchema,
  processRunTriggeredBySchema,
  processTriggerSchema,
  processTriggersSchema,
} from '../data/validators'
import { withScheduleSemanticChecks } from '../lib/tasks/scheduleValidation'
import {
  allowsManualEntry,
  eventTriggers,
  manualTrigger,
  parseProcessTriggers,
  scheduleTriggers,
} from '../lib/tasks/triggers'
import { candidateEventPatterns, matchesEventPattern } from '../lib/tasks/eventTriggerMatch'

const MODULE_ROOT = path.join(__dirname, '..')
const LOCALES = ['en', 'es', 'de', 'pl', 'ko'] as const

/**
 * Phase 2 of the triggered process model — one declared trigger list replacing
 * cron columns, the `agent_task_event_triggers` table and an undocumented run
 * route (`.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`).
 */

describe('processTriggerSchema — the persisted shape survives the collapse', () => {
  // The spec sketched `filterConditions` / `contextMapping` as `z.record(...)`
  // maps. The column has always stored ARRAYS of typed objects; carrying the
  // sketch across would have silently dropped every stored trigger config.
  const storedEventTrigger = {
    kind: 'event' as const,
    eventPattern: 'claims.*',
    config: {
      filterConditions: [
        { field: 'status', operator: 'eq' as const, value: 'open' },
        { field: 'meta.region', operator: 'in' as const, value: ['EU', 'US'] },
      ],
      contextMapping: [
        { targetKey: 'claimId', sourceExpression: 'id' },
        { targetKey: 'priority', sourceExpression: 'meta.priority', defaultValue: 'normal' },
      ],
      debounceMs: 5_000,
      maxConcurrentInstances: 3,
    },
    priority: 7,
    enabled: false,
  }

  it('round-trips every field the retired table persisted', () => {
    const parsed = processTriggerSchema.parse(storedEventTrigger)
    expect(parsed).toEqual(storedEventTrigger)
  })

  it('keeps filterConditions and contextMapping as ARRAYS, not maps', () => {
    const asMaps = {
      kind: 'event',
      eventPattern: 'claims.claim.reported',
      config: { filterConditions: { status: 'open' }, contextMapping: { claimId: 'id' } },
    }
    expect(processTriggerSchema.safeParse(asMaps).success).toBe(false)
  })

  it('defaults schedule timezone/enabled and manual requireFeatures', () => {
    expect(processTriggerSchema.parse({ kind: 'schedule', cron: '0 7 * * *' })).toEqual({
      kind: 'schedule',
      cron: '0 7 * * *',
      timezone: 'UTC',
      enabled: true,
    })
    expect(processTriggerSchema.parse({ kind: 'manual' })).toEqual({ kind: 'manual', requireFeatures: [] })
  })

  it('bounds the list at 20 entries', () => {
    const manyEvents = Array.from({ length: PROCESS_TRIGGERS_MAX }, (_, index) => ({
      kind: 'event' as const,
      eventPattern: `claims.claim.reported_${index}`,
    }))
    expect(processTriggersSchema.safeParse(manyEvents).success).toBe(true)
    expect(
      processTriggersSchema.safeParse([...manyEvents, { kind: 'manual' as const }]).success,
    ).toBe(false)
  })
})

describe('invalid cron is rejected at SAVE, not at fire time', () => {
  const base = {
    name: 'Nightly digest',
    workflowMode: 'single_agent' as const,
    singleAgent: { agentId: 'deals.lead_triage', onResult: { alwaysAsk: true as const } },
  }
  const createWithSemantics = withScheduleSemanticChecks(processDefinitionCreateSchema)

  it('rejects shape-valid cron garbage on the schedule arm', () => {
    const garbage = { ...base, triggers: [{ kind: 'schedule' as const, cron: 'foo bar baz qux quux' }] }
    // The client-safe schema gates only the SHAPE...
    expect(processDefinitionCreateSchema.safeParse(garbage).success).toBe(true)
    // ...the route-layer semantic check is what stops the save.
    const result = createWithSemantics.safeParse(garbage)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['triggers', 0, 'cron'])
  })

  it('points the issue at the offending trigger, not the first one', () => {
    const result = createWithSemantics.safeParse({
      ...base,
      triggers: [
        { kind: 'manual' as const },
        { kind: 'schedule' as const, cron: '0 7 * * 1' },
        { kind: 'schedule' as const, cron: '99 99 99 99 99' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['triggers', 2, 'cron'])
  })

  it('accepts a valid expression in a real timezone', () => {
    expect(
      createWithSemantics.safeParse({
        ...base,
        triggers: [{ kind: 'schedule' as const, cron: '0 7 * * 1', timezone: 'Europe/Warsaw' }],
      }).success,
    ).toBe(true)
  })
})

describe('candidateEventPatterns — wildcards are index-servable, not a scan', () => {
  it('enumerates exactly the patterns that can match', () => {
    expect(candidateEventPatterns('claims.claim.reported')).toEqual([
      'claims.claim.reported',
      'claims.*',
      'claims.claim.*',
    ])
    expect(candidateEventPatterns('ping')).toEqual(['ping'])
  })

  it('is complete against matchesEventPattern for every plausible pattern', () => {
    const eventName = 'claims.claim.reported'
    const candidates = new Set(candidateEventPatterns(eventName))
    const universe = [
      'claims.claim.reported',
      'claims.*',
      'claims.claim.*',
      'claims.claim.reported.*',
      'claims.claim.updated',
      'customers.*',
      'customers.deal.created',
      'claim.*',
    ]
    for (const pattern of universe) {
      expect(candidates.has(pattern)).toBe(matchesEventPattern(pattern, eventName))
    }
  })
})

describe('trigger readers', () => {
  const triggers = [
    { kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC', enabled: true },
    { kind: 'event', eventPattern: 'claims.*', priority: 0, enabled: true },
    { kind: 'manual', requireFeatures: ['sales.orders.manage'] },
  ]

  it('parses the stored column and splits it by kind', () => {
    const parsed = parseProcessTriggers(triggers)
    expect(scheduleTriggers(parsed)).toHaveLength(1)
    expect(eventTriggers(parsed)).toHaveLength(1)
    expect(manualTrigger(parsed)?.requireFeatures).toEqual(['sales.orders.manage'])
    expect(allowsManualEntry(triggers)).toBe(true)
  })

  it('drops unparseable entries instead of taking the dispatcher down', () => {
    const parsed = parseProcessTriggers([{ kind: 'event', eventPattern: 'claims.*' }, { kind: 'nonsense' }, null])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].kind).toBe('event')
  })

  it('treats a null/absent column as no declared entry point', () => {
    expect(parseProcessTriggers(null)).toEqual([])
    expect(allowsManualEntry(undefined)).toBe(false)
    expect(allowsManualEntry([])).toBe(false)
  })
})

describe('processRunTriggeredBySchema', () => {
  it('accepts the three declared kinds plus the system fallback', () => {
    expect(processRunTriggeredBySchema.parse({ kind: 'schedule' })).toEqual({ kind: 'schedule' })
    expect(processRunTriggeredBySchema.parse({ kind: 'event', ref: 'claims.*' })).toEqual({
      kind: 'event',
      ref: 'claims.*',
    })
    expect(
      processRunTriggeredBySchema.parse({ kind: 'manual', ref: '66666666-6666-4666-8666-666666666666' }).kind,
    ).toBe('manual')
    expect(processRunTriggeredBySchema.safeParse({ kind: 'api_key' }).success).toBe(false)
  })

  it('requires the event name on an event entry — "why did this run" must stay answerable', () => {
    expect(processRunTriggeredBySchema.safeParse({ kind: 'event' }).success).toBe(false)
  })
})

describe('the squashed migration', () => {
  const migration = readSquashMigrationSql()

  it('creates the declared-trigger column with its jsonb default', () => {
    expect(migration).toContain(`"triggers" jsonb null default '[]'`)
  })

  it('creates the GIN index the containment probe needs', () => {
    // The event dispatcher probes this index rather than scanning enabled
    // definitions, so losing it turns every domain event into a table scan.
    expect(migration).toContain(
      `create index "process_definitions_triggers_gin" on "process_definitions" using gin ("triggers" jsonb_path_ops)`,
    )
  })

  it('records provenance as jsonb on the execution, never as a legacy string', () => {
    expect(migration).toContain('"triggered_by" jsonb null')
  })

  it('leaves nothing of the retired trigger table or schedule columns behind', () => {
    expect(migration).not.toContain('agent_task_event_triggers')
    expect(migration).not.toContain('"schedule_cron"')
  })
})

describe('i18n coverage for the trigger editor', () => {
  const requiredKeys = [
    'agent_orchestrator.processDefinitions.list.col.triggers',
    'agent_orchestrator.processDefinitions.triggers.addEvent',
    'agent_orchestrator.processDefinitions.triggers.addSchedule',
    'agent_orchestrator.processDefinitions.triggers.cap',
    'agent_orchestrator.processDefinitions.triggers.description',
    'agent_orchestrator.processDefinitions.triggers.enabled',
    'agent_orchestrator.processDefinitions.triggers.event.config',
    'agent_orchestrator.processDefinitions.triggers.event.configHint',
    'agent_orchestrator.processDefinitions.triggers.event.pattern',
    'agent_orchestrator.processDefinitions.triggers.event.patternHint',
    'agent_orchestrator.processDefinitions.triggers.event.priority',
    'agent_orchestrator.processDefinitions.triggers.event.title',
    'agent_orchestrator.processDefinitions.triggers.manual.badge',
    'agent_orchestrator.processDefinitions.triggers.manual.disabledHint',
    'agent_orchestrator.processDefinitions.triggers.manual.requireFeatures',
    'agent_orchestrator.processDefinitions.triggers.manual.required',
    'agent_orchestrator.processDefinitions.triggers.manual.title',
    'agent_orchestrator.processDefinitions.triggers.manual.toggle',
    'agent_orchestrator.processDefinitions.triggers.none',
    'agent_orchestrator.processDefinitions.triggers.remove',
    'agent_orchestrator.processDefinitions.triggers.save',
    'agent_orchestrator.processDefinitions.triggers.saved',
    'agent_orchestrator.processDefinitions.triggers.schedule.cron',
    'agent_orchestrator.processDefinitions.triggers.schedule.timezone',
    'agent_orchestrator.processDefinitions.triggers.schedule.title',
    'agent_orchestrator.processDefinitions.triggers.title',
    'agent_orchestrator.processDefinitions.runs.triggeredBy.event',
    'agent_orchestrator.processDefinitions.runs.triggeredBy.manual',
    'agent_orchestrator.processDefinitions.runs.triggeredBy.schedule',
    'agent_orchestrator.processDefinitions.runs.triggeredBy.system',
  ]

  it.each(LOCALES)('%s carries every trigger key with interpolation tokens intact', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of requiredKeys) {
      expect(catalog[key]).toBeTruthy()
    }
    expect(catalog['agent_orchestrator.processDefinitions.triggers.cap']).toContain('{max}')
  })

  it.each(LOCALES)('%s drops the retired schedule-column and event-trigger keys', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of [
      'agent_orchestrator.processDefinitions.form.scheduleCron',
      'agent_orchestrator.processDefinitions.form.scheduleEnabled',
      'agent_orchestrator.processDefinitions.list.col.schedule',
      'agent_orchestrator.processDefinitions.triggers.addTitle',
      'agent_orchestrator.processDefinitions.triggers.confirmDelete.text',
    ]) {
      expect(catalog[key]).toBeUndefined()
    }
  })
})
