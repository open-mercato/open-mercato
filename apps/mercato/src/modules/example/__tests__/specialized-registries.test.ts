/** @jest-environment node */
import path from 'node:path'
import { extractModuleFacts } from '@open-mercato/cli/lib/generators/module-facts'
import { bundle, integrations } from '../integration'
import { exampleCurrencyRateProvider } from '../lib/mock-currency-rate-provider'
import { vectorConfig } from '../vector'
import { workflowsConfig } from '../workflows'

const moduleRoot = path.join(__dirname, '..')

describe('example specialized registries', () => {
  it('emits every specialized registry kind through the real fact extractor', () => {
    const facts = extractModuleFacts({
      moduleId: 'example',
      moduleRoot,
      portableSourceRoot: 'src/modules/example',
    })
    const registries = new Set(
      (facts.extensionSurfaces?.contributions ?? [])
        .filter((contribution) => contribution.kind === 'specialized-registry')
        .map((contribution) => contribution.details.registry),
    )

    expect([...registries].sort()).toEqual([
      'ai',
      'currency',
      'integration',
      'notification',
      'payment',
      'search',
      'shipping',
      'vector',
      'workflow',
    ])
  })

  it('declares one credential-free bundle whose provider keys match the runtime adapters', () => {
    expect(bundle.credentials.fields).toEqual([])
    expect(integrations.map((integration) => ({
      bundleId: integration.bundleId,
      category: integration.category,
      providerKey: integration.providerKey,
    }))).toEqual([
      { bundleId: bundle.id, category: 'payment', providerKey: 'mock' },
      { bundleId: bundle.id, category: 'shipping', providerKey: 'mock_carrier' },
      { bundleId: bundle.id, category: 'currency', providerKey: 'example_fixed_rates' },
    ])
  })

  it('builds deterministic vector input without exposing the encrypted notes field', async () => {
    const entity = vectorConfig.entities.find((candidate) => candidate.entityId === 'example:todo')
    expect(entity?.buildSource).toBeDefined()
    const context = {
      record: {
        id: 'todo-1',
        title: 'Review canonical facts',
        notes: 'never embed this secret',
        is_done: false,
      },
      customFields: { labels: ['facts', 'reference'] },
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }

    const first = await entity!.buildSource!(context)
    const second = await entity!.buildSource!(context)
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).toContain('Review canonical facts')
    expect(JSON.stringify(first)).not.toContain('never embed this secret')
  })

  it('declares a scoped Todo-created workflow with no external activities', () => {
    const workflow = workflowsConfig.workflows.find(
      (candidate) => candidate.workflowId === 'example.todo-created-reference',
    )
    expect(workflow?.moduleId).toBe('example')
    expect(workflow?.definition.triggers).toEqual([
      expect.objectContaining({
        eventPattern: 'example.todo.created',
        enabled: true,
        config: expect.objectContaining({ entityType: 'example:todo' }),
      }),
    ])
    expect(workflow?.definition.steps.flatMap((step) => step.activities ?? [])).toEqual([])
    expect(workflow?.definition.transitions.flatMap((transition) => transition.activities ?? [])).toEqual([])
  })

  it('returns the same credential-free currency rates for the same date and currency set', async () => {
    const date = new Date('2026-08-10T00:00:00.000Z')
    const input = [
      date,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
      new Set(['USD', 'EUR']),
    ] as const
    const first = await exampleCurrencyRateProvider.fetchRates(...input)
    const second = await exampleCurrencyRateProvider.fetchRates(...input)

    expect(second).toEqual(first)
    expect(first).toEqual([
      expect.objectContaining({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.9200',
        source: 'example_fixed_rates',
        date,
      }),
      expect.objectContaining({
        fromCurrencyCode: 'EUR',
        toCurrencyCode: 'USD',
        rate: '1.0870',
        source: 'example_fixed_rates',
        date,
      }),
    ])
  })
})

