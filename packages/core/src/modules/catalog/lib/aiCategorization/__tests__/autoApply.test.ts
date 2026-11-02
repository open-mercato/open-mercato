import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CatalogProductCategorySuggestion } from '../../../data/entities'
import { decideAutoApply, maybeAutoApplySuggestion } from '../autoApply'

const reportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

const SUGGESTION = '44444444-4444-4444-8444-444444444444'
const settingsOn = { applyMode: 'auto_apply' as const, autoApplyThreshold: 0.85 }

function buildSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: SUGGESTION,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    product: { id: 'product-1' },
    outcome: 'suggested',
    categoryId: 'category-1',
    confidence: '0.9000',
    status: 'pending',
    ...overrides,
  } as unknown as CatalogProductCategorySuggestion
}

function buildDeps(options: { assignmentCount?: number; execute?: jest.Mock } = {}) {
  const execute = options.execute ?? jest.fn().mockResolvedValue({
    result: { product: { id: 'product-1', categoryIds: ['category-1'], updatedAt: '2026-01-01T00:00:00.000Z' } },
    logEntry: { id: 'log-1' },
  })
  const container = { resolve: jest.fn(() => ({ execute })) } as unknown as AwilixContainer
  const em = { count: jest.fn().mockResolvedValue(options.assignmentCount ?? 0) } as unknown as EntityManager
  const commandContext = { container } as unknown as CommandRuntimeContext
  return { container, em, execute, commandContext }
}

describe('decideAutoApply', () => {
  it('applies a user-started suggestion at exactly the threshold', () => {
    const decision = decideAutoApply({
      settings: settingsOn,
      trigger: 'manual',
      suggestion: buildSuggestion({ confidence: '0.8500' }),
    })
    expect(decision).toEqual({ apply: true })
  })

  it('does not apply just below the threshold', () => {
    const decision = decideAutoApply({
      settings: settingsOn,
      trigger: 'bulk',
      suggestion: buildSuggestion({ confidence: '0.8499' }),
    })
    expect(decision).toEqual({ apply: false, reason: 'below_threshold' })
  })

  it('never applies in suggest mode', () => {
    const decision = decideAutoApply({
      settings: { applyMode: 'suggest', autoApplyThreshold: 0.5 },
      trigger: 'manual',
      suggestion: buildSuggestion({ confidence: '1.0000' }),
    })
    expect(decision).toEqual({ apply: false, reason: 'mode_suggest' })
  })

  it('never applies for on_create runs, whatever the confidence', () => {
    const decision = decideAutoApply({
      settings: settingsOn,
      trigger: 'on_create',
      suggestion: buildSuggestion({ confidence: '1.0000' }),
    })
    expect(decision).toEqual({ apply: false, reason: 'trigger_not_user_started' })
  })

  it('does not apply no_match outcomes or already reviewed suggestions', () => {
    expect(
      decideAutoApply({ settings: settingsOn, trigger: 'manual', suggestion: buildSuggestion({ outcome: 'no_match', categoryId: null, confidence: null }) }),
    ).toEqual({ apply: false, reason: 'not_suggested' })
    expect(
      decideAutoApply({ settings: settingsOn, trigger: 'manual', suggestion: buildSuggestion({ status: 'superseded' }) }),
    ).toEqual({ apply: false, reason: 'not_pending' })
  })
})

describe('maybeAutoApplySuggestion', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runs the accept command with autoApplied and returns the updated product', async () => {
    const deps = buildDeps()
    const result = await maybeAutoApplySuggestion({ ...deps, suggestion: buildSuggestion(), trigger: 'manual', settings: settingsOn })
    expect(deps.execute).toHaveBeenCalledWith('catalog.category_suggestions.accept', {
      input: { id: SUGGESTION, autoApplied: true },
      ctx: deps.commandContext,
    })
    expect(result).toMatchObject({ applied: true, product: { categoryIds: ['category-1'] } })
  })

  it('leaves a product that already has a category pending without calling the command', async () => {
    const deps = buildDeps({ assignmentCount: 1 })
    const result = await maybeAutoApplySuggestion({ ...deps, suggestion: buildSuggestion(), trigger: 'bulk', settings: settingsOn })
    expect(result).toEqual({ applied: false, reason: 'already_categorized' })
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('treats the command-level already-categorized race as a quiet skip', async () => {
    const execute = jest.fn().mockRejectedValue(new CrudHttpError(409, { code: 'product_already_categorized' }))
    const deps = buildDeps({ execute })
    const result = await maybeAutoApplySuggestion({ ...deps, suggestion: buildSuggestion(), trigger: 'manual', settings: settingsOn })
    expect(result).toEqual({ applied: false, reason: 'already_categorized' })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('does not throw and reports when the accept command fails', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('[internal] boom'))
    const deps = buildDeps({ execute })
    const result = await maybeAutoApplySuggestion({ ...deps, suggestion: buildSuggestion(), trigger: 'manual', settings: settingsOn })
    expect(result).toEqual({ applied: false, reason: 'accept_failed' })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('skips on_create and suggest mode without touching the database', async () => {
    const deps = buildDeps()
    await maybeAutoApplySuggestion({ ...deps, suggestion: buildSuggestion(), trigger: 'on_create', settings: settingsOn })
    await maybeAutoApplySuggestion({
      ...deps,
      suggestion: buildSuggestion(),
      trigger: 'manual',
      settings: { applyMode: 'suggest', autoApplyThreshold: 0.5 },
    })
    expect(deps.em.count).not.toHaveBeenCalled()
    expect(deps.execute).not.toHaveBeenCalled()
  })
})
