import { planGenerateWatchChanges, type GenerateWatchChange } from '../generate-watch-plan'

function change(category: GenerateWatchChange['category'], path: string, extensionId?: string): GenerateWatchChange {
  return { kind: 'change', key: path, category, path, ...(extensionId ? { extensionId } : {}) }
}

describe('planGenerateWatchChanges', () => {
  it('selects only API consumers for API changes, including deletion', () => {
    const plan = planGenerateWatchChanges([{ ...change('api-route', '/customers/api/items/route.ts'), kind: 'delete' }])
    expect(plan.mode).toBe('incremental')
    expect(plan.groups).toEqual(['registry', 'openapi'])
    expect(plan.registryOutputs).toEqual(['main', 'runtime', 'api-routes'])
  })

  it('unions page consumers without bootstrap, CLI or independent extensions', () => {
    const plan = planGenerateWatchChanges([
      change('frontend-page', '/customers/frontend/page.tsx'),
      change('backend-page', '/customers/backend/page.meta.ts'),
    ])
    expect(plan.groups).toEqual(['registry'])
    expect(plan.registryOutputs).toEqual(['main', 'runtime', 'app', 'frontend-routes', 'backend-routes'])
  })

  it('preserves suite order while selecting independent entity, DI and extension work', () => {
    const changes = [
      change('di', '/customers/di.ts'), change('search', '/customers/search.ts'),
      change('entities', '/customers/data/entities.ts'),
    ]
    const plan = planGenerateWatchChanges(changes)
    expect(plan.groups).toEqual(['entity-ids', 'registry', 'entities', 'di'])
    expect(plan.registryOutputs).toEqual(['registry.search'])
    expect(planGenerateWatchChanges([...changes].reverse())).toEqual(plan)
  })

  it('includes only proven extension shared-import and command-loader consumers', () => {
    const plan = planGenerateWatchChanges([
      change('extension', '/customers/analytics.ts', 'registry.analytics'),
      change('extension', '/customers/commands/interceptors.ts', 'registry.command-interceptors'),
      change('extension', '/customers/notifications.client.ts', 'registry.notifications'),
    ])
    expect(plan.groups).toEqual(['registry'])
    expect(plan.registryOutputs).toEqual(['main', 'commands', 'registry.notifications', 'registry.analytics', 'registry.command-interceptors'])
  })

  it('keeps injection tables and widgets in one aggregate but not unrelated widget outputs', () => {
    expect(planGenerateWatchChanges([change('injection-widgets', '/customers/widgets/injection-table.ts')]).registryOutputs)
      .toEqual(['registry.injection-widgets'])
    expect(planGenerateWatchChanges([change('dashboard-widgets', '/customers/widgets/dashboard/stats/widget.ts')]).registryOutputs)
      .toEqual(['main', 'app', 'bootstrap', 'cli', 'registry.dashboard-widgets'])
  })

  it('retains worker supervisor and i18n helper dependencies', () => {
    const plan = planGenerateWatchChanges([change('workers', '/customers/workers/job.ts')])
    expect(plan.registryOutputs).toEqual(['main', 'runtime', 'app', 'bootstrap', 'cli', 'i18n', 'supervisor'])
    expect(plan.groups).toEqual(['registry'])
  })

  it('distinguishes vector-only CLI configuration from shared registry conventions', () => {
    expect(planGenerateWatchChanges([change('registry-convention', '/customers/vector.js')]).registryOutputs).toEqual(['cli'])
    expect(planGenerateWatchChanges([change('registry-convention', '/customers/runtime.ts')]).registryOutputs)
      .toEqual(['main', 'runtime', 'app', 'bootstrap', 'cli'])
  })

  it('updates supervisor CLI state only for the scheduler convention', () => {
    expect(planGenerateWatchChanges([change('cli', '/customers/cli.ts')]).registryOutputs).toEqual(['main', 'cli'])
    expect(planGenerateWatchChanges([change('cli', '/scheduler/cli.ts')]).registryOutputs).toEqual(['main', 'cli', 'supervisor'])
  })

  it.each(['configuration', 'generator-plugin', 'unknown'] as const)('lets %s fallback dominate narrow work and reports why', (category) => {
    const path = '/customers/dependency.ts'
    const plan = planGenerateWatchChanges([change('api-route', '/customers/api/route.ts'), change(category, path)])
    expect(plan.mode).toBe('full')
    expect(plan.groups).toEqual(['entity-ids', 'registry', 'entities', 'di', 'package-sources', 'web-research-adapters', 'openapi'])
    expect(plan.reasons).toEqual([expect.stringContaining(path)])
  })

  it('does not narrow an unknown extension to an unrecognized output group', () => {
    const plan = planGenerateWatchChanges([change('extension', '/customers/custom.ts', 'third-party.dynamic')])
    expect(plan.mode).toBe('full')
    expect(plan.reasons).toEqual(['Unknown generator extension dependency: /customers/custom.ts'])
  })

  it('treats scan uncertainty as full even without a diff, but clean empty diffs as no work', () => {
    expect(planGenerateWatchChanges([], ['Cannot scan generator inputs: /customers']).mode).toBe('full')
    expect(planGenerateWatchChanges([])).toEqual({ mode: 'none', groups: [], registryOutputs: [], changes: [], reasons: [] })
  })
})
