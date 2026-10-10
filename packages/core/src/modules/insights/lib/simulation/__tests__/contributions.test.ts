import fs from 'node:fs'
import path from 'node:path'
import { SIMULATION_EVENT_ID_PATTERN } from '@open-mercato/shared/modules/insights/simulate'
import { listCatalogPriceLineSources } from '@open-mercato/core/modules/catalog/lib/simulation/priceLineSources'
import { simulateConfigPlugin } from '../../../generators'
import { getSimulationKind, listSimulationEventAdapters, registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../registry'

const MODULES_ROOT = path.join(__dirname, '..', '..', '..', '..')

function discoverConventionFiles(): Array<{ moduleId: string; file: string }> {
  return fs.readdirSync(MODULES_ROOT)
    .map((moduleId) => ({ moduleId, file: path.join(MODULES_ROOT, moduleId, simulateConfigPlugin.conventionFile) }))
    .filter((entry) => fs.existsSync(entry.file))
}

describe('insights.simulate.ts contributions of the core modules', () => {
  beforeEach(() => resetSimulationRegistryForTests())

  it('are discovered by the generator convention and register the rule, trigger and price backtests, the role permission preview, the price line sources and the event adapters', async () => {
    const discovered = discoverConventionFiles()
    expect(discovered.map((entry) => entry.moduleId).sort()).toEqual(['auth', 'business_rules', 'catalog', 'customers', 'sales', 'workflows'])
    const entries = []
    for (const entry of discovered) {
      const exported = (await import(entry.file)) as { default?: unknown; simulateConfig?: unknown }
      entries.push({ moduleId: entry.moduleId, config: exported.default ?? exported.simulateConfig ?? null })
    }
    registerSimulateConfigEntries(entries)
    const kind = getSimulationKind('business_rules.rule_backtest')
    expect(kind?.moduleId).toBe('business_rules')
    expect(kind?.definition.requiredFeatures).toEqual(['business_rules.view', 'business_rules.view_logs'])
    const triggerKind = getSimulationKind('workflows.trigger_backtest')
    expect(triggerKind?.moduleId).toBe('workflows')
    expect(triggerKind?.definition.requiredFeatures).toEqual(['workflows.definitions.view'])
    expect(triggerKind?.definition.artifactKind).toBe('workflows.definition')
    const aclKind = getSimulationKind('auth.role_acl_preview')
    expect(aclKind?.moduleId).toBe('auth')
    expect(aclKind?.definition.requiredFeatures).toEqual(['auth.acl.manage', 'auth.users.list'])
    expect(aclKind?.definition.artifactKind).toBe('auth.role_acl')
    expect(aclKind?.definition.execution).toBe('inline')
    expect(aclKind?.definition.ttlHours).toBe(24)
    expect(aclKind?.definition.accessLogResourceKind).toBe('insights.simulation.permission_preview')
    expect(aclKind?.definition.liveRecords?.requiredFeatures).toEqual(['auth.users.list'])
    const priceKind = getSimulationKind('catalog.price_backtest')
    expect(priceKind?.moduleId).toBe('catalog')
    expect(priceKind?.definition.requiredFeatures).toEqual(['catalog.pricing.manage'])
    expect(priceKind?.definition.artifactKind).toBe('catalog.price')
    expect(listCatalogPriceLineSources().map((source) => [source.family, source.requiredFeatures])).toEqual([
      ['orders', ['sales.orders.view']],
      ['quotes', ['sales.quotes.view']],
    ])
    const adapters = listSimulationEventAdapters()
    expect(adapters.map((adapter) => adapter.eventId)).toEqual(expect.arrayContaining([
      'customers.deal.updated',
      'customers.deal.won',
      'customers.person.created',
      'customers.company.deleted',
      'sales.order.created',
      'sales.quote.created',
    ]))
    for (const adapter of adapters) expect(adapter.eventId).toMatch(SIMULATION_EVENT_ID_PATTERN)
    expect(new Set(adapters.map((adapter) => adapter.moduleId))).toEqual(new Set(['customers', 'sales']))
  })
})
