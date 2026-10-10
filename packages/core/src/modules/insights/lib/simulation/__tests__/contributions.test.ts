import fs from 'node:fs'
import path from 'node:path'
import { SIMULATION_EVENT_ID_PATTERN } from '@open-mercato/shared/modules/insights/simulate'
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

  it('are discovered by the generator convention and register the rule and trigger backtests and the event adapters', async () => {
    const discovered = discoverConventionFiles()
    expect(discovered.map((entry) => entry.moduleId).sort()).toEqual(['business_rules', 'customers', 'sales', 'workflows'])
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
