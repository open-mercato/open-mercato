/** @jest-environment node */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createContainer } from 'awilix'
import { extractModuleFacts } from '@open-mercato/cli/lib/generators/module-facts'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getGatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'
import { getShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import type { RateProvider } from '@open-mercato/core/modules/currencies/services/providers/base'
import { getCurrencyRateProvider } from '@open-mercato/core/modules/currencies/services/providers/registry'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  VectorIndexService,
  type EmbeddingService,
  type VectorDriver,
  type VectorDriverDocument,
} from '@open-mercato/search/vector'
import { EXAMPLE_CURRENCY_RATE_PROVIDER, register } from '../di'
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

  it('indexes the scoped Todo through the vector service and skips an unchanged checksum', async () => {
    const tenantId = 'tenant-1'
    const organizationId = 'org-1'
    const recordId = 'todo-1'
    const documents = new Map<string, VectorDriverDocument>()
    const query = jest.fn().mockResolvedValue({
      items: [{
        id: recordId,
        title: 'Review canonical facts',
        notes: 'never embed this secret',
        is_done: false,
        'cf:labels': ['facts', 'reference'],
      }],
      page: 1,
      pageSize: 1,
      total: 1,
    })
    const queryEngine = { query } as unknown as QueryEngine
    const driver: VectorDriver = {
      id: 'pgvector',
      async ensureReady() {},
      async upsert(document) {
        documents.set(document.recordId, document)
      },
      async delete(_entityId, id) {
        documents.delete(id)
      },
      async query() {
        return []
      },
      async getChecksum(_entityId, id) {
        return documents.get(id)?.checksum ?? null
      },
    }
    const embeddingService = {
      available: true,
      async createEmbedding(input: string | string[]) {
        const text = Array.isArray(input) ? input.join('\n') : input
        return [text.length, 1]
      },
    } as unknown as EmbeddingService
    const service = new VectorIndexService({
      drivers: [driver],
      embeddingService,
      queryEngine,
      moduleConfigs: [vectorConfig],
    })

    await expect(service.indexRecord({
      entityId: 'example:todo',
      recordId,
      tenantId,
      organizationId,
    })).resolves.toMatchObject({ action: 'indexed', tenantId, organizationId })
    expect(query).toHaveBeenCalledWith('example:todo', expect.objectContaining({
      tenantId,
      organizationId,
      filters: { id: { $in: [recordId] } },
    }))
    expect(JSON.stringify(documents.get(recordId))).toContain('Review canonical facts')
    expect(JSON.stringify(documents.get(recordId))).not.toContain('never embed this secret')

    await expect(service.indexRecord({
      entityId: 'example:todo',
      recordId,
      tenantId,
      organizationId,
    })).resolves.toMatchObject({ action: 'skipped', reason: 'checksum_match', existed: true })
    expect(documents.size).toBe(1)
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

  it('registers callable payment, shipping, and currency providers through their runtime paths', async () => {
    const container = createContainer() as unknown as AppContainer
    register(container)

    const paymentAdapter = getGatewayAdapter('mock')
    expect(paymentAdapter).toBeDefined()
    await expect(paymentAdapter!.createSession({
      paymentId: randomUUID(),
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      amount: 12.34,
      currencyCode: 'USD',
      credentials: {},
    })).resolves.toMatchObject({ status: 'captured' })

    const shippingAdapter = getShippingAdapter('mock_carrier')
    expect(shippingAdapter).toBeDefined()
    const rates = await shippingAdapter!.calculateRates({
      origin: { countryCode: 'US', city: 'New York', postalCode: '10001', line1: '1 Main St' },
      destination: { countryCode: 'US', city: 'Boston', postalCode: '02108', line1: '1 Beacon St' },
      packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
      credentials: {},
    })
    expect(rates.map((rate) => rate.serviceCode)).toEqual(['standard', 'express'])

    const currencyProvider = container.resolve<RateProvider>(EXAMPLE_CURRENCY_RATE_PROVIDER)
    expect(getCurrencyRateProvider('example_fixed_rates')).toBe(currencyProvider)
    const date = new Date('2026-08-10T00:00:00.000Z')
    await expect(currencyProvider.fetchRates(
      date,
      { tenantId: randomUUID(), organizationId: randomUUID() },
      new Set(['USD', 'EUR']),
    )).resolves.toEqual([
      expect.objectContaining({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', rate: '0.9200', date }),
      expect.objectContaining({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.0870', date }),
    ])
  })
})
