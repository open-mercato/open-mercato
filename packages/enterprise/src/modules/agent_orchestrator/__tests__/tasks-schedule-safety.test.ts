/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import {
  agentTaskDefinitionCreateSchema,
  isValidIanaTimeZone,
} from '../data/validators'
import { withScheduleSemanticChecks } from '../lib/tasks/scheduleValidation'
import { metadata as featuresMetadata } from '../api/features/route'
import {
  WORKFLOW_TARGET_PREFILL_FEATURES,
  listTimeZones,
  parseGrantedFeaturesText,
  resolveFeaturePrefill,
  unknownFeatureIds,
} from '../backend/agentic-tasks/formHelpers'

const MODULE_ROOT = path.join(__dirname, '..')
const LOCALES = ['en', 'es', 'de', 'pl'] as const

const baseTask = {
  name: 'Nightly digest',
  targetType: 'agent' as const,
  targetAgentId: 'deals.lead_triage',
}

const createWithSemantics = withScheduleSemanticChecks(agentTaskDefinitionCreateSchema)

describe('schedule semantic validation (route layer)', () => {
  it('rejects shape-valid cron garbage the token regex accepts', () => {
    const shapeOnly = agentTaskDefinitionCreateSchema.safeParse({
      ...baseTask,
      scheduleCron: 'foo bar baz qux quux',
    })
    expect(shapeOnly.success).toBe(true)

    const semantic = createWithSemantics.safeParse({ ...baseTask, scheduleCron: 'foo bar baz qux quux' })
    expect(semantic.success).toBe(false)
    if (!semantic.success) {
      expect(semantic.error.issues[0]?.path).toEqual(['scheduleCron'])
    }
  })

  it('accepts a valid 5-field expression', () => {
    expect(createWithSemantics.safeParse({ ...baseTask, scheduleCron: '0 7 * * 1' }).success).toBe(true)
  })

  it('leaves schedule-less tasks untouched', () => {
    expect(createWithSemantics.safeParse(baseTask).success).toBe(true)
    expect(createWithSemantics.safeParse({ ...baseTask, scheduleCron: null }).success).toBe(true)
  })
})

describe('timezone validation (shared schema)', () => {
  it('rejects non-IANA values like "Warsaw"', () => {
    const result = agentTaskDefinitionCreateSchema.safeParse({ ...baseTask, scheduleTimezone: 'Warsaw' })
    expect(result.success).toBe(false)
  })

  it('accepts "Europe/Warsaw"', () => {
    expect(
      agentTaskDefinitionCreateSchema.safeParse({ ...baseTask, scheduleTimezone: 'Europe/Warsaw' }).success,
    ).toBe(true)
  })

  it('isValidIanaTimeZone matches the schema behavior', () => {
    expect(isValidIanaTimeZone('Europe/Warsaw')).toBe(true)
    expect(isValidIanaTimeZone('Warsaw')).toBe(false)
    expect(isValidIanaTimeZone('UTC')).toBe(true)
  })
})

describe('GET /api/agent_orchestrator/features — gate and shape', () => {
  it('is gated by tasks.manage (not the auth route\'s acl.manage)', () => {
    expect(featuresMetadata.GET.requireAuth).toBe(true)
    expect(featuresMetadata.GET.requireFeatures).toEqual(['agent_orchestrator.tasks.manage'])
  })

  it('reads the static module catalog only — no RBAC/entity data path', () => {
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'api', 'features', 'route.ts'), 'utf8')
    expect(source).toContain('getModules()')
    expect(source).not.toMatch(/\bRole\b|rbacService|em\.find|createRequestContainer/)
  })
})

describe('formHelpers — permissions picker logic', () => {
  it('parses newline-separated feature text with trim + dedupe', () => {
    expect(parseGrantedFeaturesText(' a.view \n\nb.manage\na.view\n')).toEqual(['a.view', 'b.manage'])
    expect(parseGrantedFeaturesText(undefined)).toEqual([])
  })

  it('prefills the workflow least-privilege floor only for empty workflow targets', () => {
    expect(resolveFeaturePrefill('workflow', [])).toEqual([...WORKFLOW_TARGET_PREFILL_FEATURES])
    expect(resolveFeaturePrefill('workflow', ['x.view'])).toBeNull()
    expect(resolveFeaturePrefill('agent', [])).toBeNull()
  })

  it('prefill floor uses real core workflows feature ids', () => {
    expect(WORKFLOW_TARGET_PREFILL_FEATURES).toEqual(['workflows.instances.view', 'workflows.instances.create'])
    const aclSource = fs.readFileSync(
      path.join(MODULE_ROOT, '..', '..', '..', '..', 'core', 'src', 'modules', 'workflows', 'acl.ts'),
      'utf8',
    )
    for (const feature of WORKFLOW_TARGET_PREFILL_FEATURES) {
      expect(aclSource).toContain(`'${feature}'`)
    }
  })

  it('flags unknown ids but honors exact matches, wildcards, and the global star', () => {
    const catalog = ['workflows.instances.view', 'workflows.instances.create', 'sales.orders.view']
    expect(unknownFeatureIds(['workflows.instances.view'], catalog)).toEqual([])
    expect(unknownFeatureIds(['workflows.*'], catalog)).toEqual([])
    expect(unknownFeatureIds(['*'], catalog)).toEqual([])
    expect(unknownFeatureIds(['custom_module.thing.view'], catalog)).toEqual(['custom_module.thing.view'])
    expect(unknownFeatureIds(['custom.*'], catalog)).toEqual(['custom.*'])
  })

  it('lists IANA timezones (runtime or fallback), always including UTC + Europe/Warsaw', () => {
    const zones = listTimeZones()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('UTC')
    expect(zones).toContain('Europe/Warsaw')
  })
})

describe('i18n coverage for the scheduling-safety copy', () => {
  const requiredKeys = [
    'agent_orchestrator.tasks.detail.scheduleInvalid',
    'agent_orchestrator.tasks.detail.scheduleNextRun',
    'agent_orchestrator.tasks.form.errors.cronInvalid',
    'agent_orchestrator.tasks.form.errors.timezoneInvalid',
    'agent_orchestrator.tasks.form.featuresAdd',
    'agent_orchestrator.tasks.form.featuresAddAction',
    'agent_orchestrator.tasks.form.featuresRemove',
    'agent_orchestrator.tasks.form.featuresUnknown',
    'agent_orchestrator.tasks.form.nextRuns',
    'agent_orchestrator.tasks.form.nextRunsInvalid',
    'agent_orchestrator.tasks.form.workflowGrantsWarning',
  ]

  it.each(LOCALES)('%s carries every key with interpolation tokens intact', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of requiredKeys) {
      expect(catalog[key]).toBeTruthy()
    }
    expect(catalog['agent_orchestrator.tasks.detail.scheduleNextRun']).toContain('{time}')
    expect(catalog['agent_orchestrator.tasks.form.nextRunsInvalid']).toContain('{error}')
    expect(catalog['agent_orchestrator.tasks.form.featuresRemove']).toContain('{id}')
  })
})
