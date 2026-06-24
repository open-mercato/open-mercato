import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { ContextResolverImpl } from '../lib/context/contextResolver'
import {
  registerContextModule,
  entityProvenance,
  type ContextModule,
} from '../lib/context/registry'
import {
  DocumentIngestServiceImpl,
  type DocumentIngestService,
  formatDocumentLocator,
} from '../lib/context/documentIngest'
import {
  documentExtractionToCandidates,
  DEFAULT_DOCUMENT_MIN_CONFIDENCE,
} from '../lib/context/documentSource'
import type {
  DocumentOcrInput,
  DocumentOcrProvider,
  DocumentOcrResult,
} from '../lib/context/documentOcrProvider'
import {
  contextBundleRoutedSourcesSchema,
  contextBundleSourcesSchema,
  documentExtractionSchema,
  type ContextRoutedSource,
} from '../data/validators'

/**
 * In-memory EntityManager fake (mirrors context-assembly.test.ts) covering the
 * create/persist/flush surface the resolver uses.
 */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }

  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_ORG = '44444444-4444-4444-4444-444444444444'
const RUN_ID = '55555555-5555-5555-5555-555555555555'

const CAPABILITY = 'test.document.capability'
const MANDATORY_ENTITY = 'test:document_subject'
const ATTACHMENT_ID = 'attachment-abc'

const TEST_MODULE: ContextModule = {
  capability: CAPABILITY,
  sources: [
    {
      kind: 'entity',
      tier: 'mandatory',
      entityType: MANDATORY_ENTITY,
      priority: 0,
      fields: ['id', 'title'],
      provenance: entityProvenance(MANDATORY_ENTITY),
    },
  ],
}

beforeAll(() => {
  registerContextModule(TEST_MODULE)
})

/**
 * A fake OCR provider — proves the OCR/layout engine is swappable behind the DI
 * seam. It records the scope it was called with (to assert tenancy) and returns a
 * fixed text + page geometry. No network/model call.
 */
class FakeOcrProvider implements DocumentOcrProvider {
  readonly id = 'ocr_fake'
  readonly calls: DocumentOcrInput[] = []

  constructor(private readonly result: DocumentOcrResult) {}

  async extract(input: DocumentOcrInput): Promise<DocumentOcrResult> {
    this.calls.push(input)
    return this.result
  }
}

function fakeContainer(opts: {
  fixtures: Record<string, Array<Record<string, unknown>>>
  ingestService?: DocumentIngestService
  queryCalls?: Array<{ entity: string; opts: QueryOptions }>
}): AwilixContainer {
  const queryEngine: QueryEngine = {
    async query<T = unknown>(entity: string, queryOpts: QueryOptions = {}): Promise<QueryResult<T>> {
      opts.queryCalls?.push({ entity, opts: queryOpts })
      const items = (opts.fixtures[entity] ?? []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
  return {
    hasRegistration(name: string) {
      if (name === 'queryEngine') return true
      if (name === 'agentDocumentIngestService') return Boolean(opts.ingestService)
      return false
    },
    resolve(name: string) {
      if (name === 'queryEngine') return queryEngine
      if (name === 'agentDocumentIngestService' && opts.ingestService) return opts.ingestService
      throw new Error(`[internal] unexpected resolve("${name}") in test`)
    },
  } as unknown as AwilixContainer
}

function baseInput(extra: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    agentRunId: RUN_ID,
    processId: null,
    stepId: null,
    capability: CAPABILITY,
    budget: 4000,
    ...extra,
  }
}

const INVOICE_OCR: DocumentOcrResult = {
  text: 'Invoice Number: INV-42\nAmount Due: 1200.50\nVendor: Acme Corp',
  pages: [
    {
      page: 1,
      blocks: [
        { text: 'Invoice Number: INV-42\nAmount Due: 1200.50\nVendor: Acme Corp', page: 1 },
      ],
    },
  ],
}

describe('DocumentIngestServiceImpl — lineage + confidence (Phase 3)', () => {
  it('extracts typed facts each carrying source doc + locator + confidence', async () => {
    const provider = new FakeOcrProvider(INVOICE_OCR)
    const service = new DocumentIngestServiceImpl({} as AwilixContainer, { provider })

    const extraction = await service.ingest({
      sourceRef: ATTACHMENT_ID,
      buffer: Buffer.from('bytes'),
      mimeType: 'application/pdf',
      scope: { tenantId: TENANT, organizationId: ORG },
    })

    // Schema-valid extraction; classified as invoice; engine = the fake provider.
    documentExtractionSchema.parse(extraction)
    expect(extraction.docType).toBe('invoice')
    expect(extraction.engine).toBe('ocr_fake')
    expect(extraction.facts.length).toBeGreaterThan(0)

    for (const fact of extraction.facts) {
      // Lineage: every fact links to its source document + locator + confidence.
      expect(fact.sourceRef).toBe(ATTACHMENT_ID)
      expect(fact.locator.page).toBe(1)
      expect(formatDocumentLocator(fact.locator)).toBe('page:1')
      expect(fact.confidence).toBeGreaterThan(0)
      expect(fact.confidence).toBeLessThanOrEqual(1)
      expect(typeof fact.value).toBe('string')
    }
    // The invoice number fact is present with its value.
    const invoiceNumber = extraction.facts.find((fact) => fact.field === 'invoice_number')
    expect(invoiceNumber?.value).toBe('INV-42')
  })

  it('passes the run scope to the OCR provider (never cross-tenant)', async () => {
    const provider = new FakeOcrProvider(INVOICE_OCR)
    const service = new DocumentIngestServiceImpl({} as AwilixContainer, { provider })

    await service.ingest({
      sourceRef: ATTACHMENT_ID,
      buffer: Buffer.from('bytes'),
      mimeType: 'application/pdf',
      scope: { tenantId: TENANT, organizationId: ORG },
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].scope.tenantId).toBe(TENANT)
    expect(provider.calls[0].scope.organizationId).toBe(ORG)
    expect(provider.calls[0].scope.organizationId).not.toBe(OTHER_ORG)
  })

  it('is provider-swappable: a custom region-aware provider yields page#bbox locators + provider confidence', async () => {
    const provider: DocumentOcrProvider = {
      id: 'ocr_idp_like',
      async extract(): Promise<DocumentOcrResult> {
        return {
          text: 'Policy Number: P-9',
          pages: [
            {
              page: 2,
              blocks: [{ text: 'Policy Number: P-9', page: 2, region: [10, 20, 30, 40] }],
            },
          ],
          confidence: 0.5,
        }
      },
    }
    const service = new DocumentIngestServiceImpl({} as AwilixContainer, { provider })

    const extraction = await service.ingest({
      sourceRef: ATTACHMENT_ID,
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
      scope: { tenantId: TENANT, organizationId: ORG },
    })

    expect(extraction.engine).toBe('ocr_idp_like')
    expect(extraction.docType).toBe('policy_document')
    const fact = extraction.facts.find((entry) => entry.field === 'policy_number')
    expect(fact).toBeDefined()
    expect(fact?.locator.page).toBe(2)
    expect(fact?.locator.region).toEqual([10, 20, 30, 40])
    expect(formatDocumentLocator(fact!.locator)).toBe('page:2#10,20,30,40')
    // Provider confidence (0.5) narrows the per-fact confidence (0.6 * 0.5 = 0.3).
    expect(fact?.confidence).toBeCloseTo(0.3, 5)
  })
})

describe('documentExtractionToCandidates — low-confidence excludable from routing', () => {
  it('drops facts below the confidence floor; keeps the rest as citable hits', () => {
    const extraction = documentExtractionSchema.parse({
      sourceRef: ATTACHMENT_ID,
      docType: 'invoice',
      engine: 'ocr_fake',
      facts: [
        { field: 'high', value: 'keep', sourceRef: ATTACHMENT_ID, locator: { page: 1 }, confidence: 0.9 },
        { field: 'low', value: 'drop', sourceRef: ATTACHMENT_ID, locator: { page: 1 }, confidence: 0.2 },
      ],
    })

    const candidates = documentExtractionToCandidates(extraction, { minConfidence: DEFAULT_DOCUMENT_MIN_CONFIDENCE })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].fact.field).toBe('high')
    // Citable: every surviving hit carries a sourceRef + locator + score.
    expect(candidates[0].hit.ref).toBe(ATTACHMENT_ID)
    expect(candidates[0].hit.locator).toBe('page:1')
    expect(candidates[0].hit.score).toBe(0.9)
  })
})

describe('ContextResolver.assemble — document facts flow into the bundle as citable sources', () => {
  it('ingests documents via the swappable pipeline and packs them as `document` sources with provenance', async () => {
    const provider = new FakeOcrProvider(INVOICE_OCR)
    const ingestService = new DocumentIngestServiceImpl({} as AwilixContainer, { provider })
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'Acme deal' }] },
      ingestService,
    })
    const resolver = new ContextResolverImpl(container)

    const { bundle } = await resolver.assemble(
      em(),
      baseInput({
        documentInputs: [
          { sourceRef: ATTACHMENT_ID, buffer: Buffer.from('pdf'), mimeType: 'application/pdf' },
        ],
      }) as never,
    )

    const routed = contextBundleRoutedSourcesSchema.parse(bundle.routedSources) as ContextRoutedSource[]
    const sources = contextBundleSourcesSchema.parse(bundle.sources)

    // Mandatory entity floor still routed.
    expect(routed.some((source) => source.kind === 'entity' && source.ref === 'subject-1')).toBe(true)

    // Document facts routed as citable `document` sources (sourceRef + locator + score).
    const documentRouted = routed.filter((source) => source.kind === 'document')
    expect(documentRouted.length).toBeGreaterThan(0)
    for (const source of documentRouted) {
      expect(source.ref).toBe(ATTACHMENT_ID)
      expect(source.locator).toBe('page:1')
      expect(typeof source.score).toBe('number')
    }

    // Provenance: each document fact links to its source attachment + locator (lineage).
    const documentProvenances = sources.filter((fact) => fact.sourceKind === 'document')
    expect(documentProvenances.length).toBeGreaterThan(0)
    for (const fact of documentProvenances) {
      expect(fact.sourceRef).toBe(ATTACHMENT_ID)
      expect(fact.locator).toBe('page:1')
      expect(fact.factId.startsWith('document:')).toBe(true)
    }
  })

  it('folds pre-ingested extractions in and excludes low-confidence facts from routing', async () => {
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'subj' }] },
    })
    const resolver = new ContextResolverImpl(container)

    const extraction = documentExtractionSchema.parse({
      sourceRef: ATTACHMENT_ID,
      docType: 'claim_form',
      engine: 'ocr_fake',
      facts: [
        { field: 'claimant', value: 'Jane', sourceRef: ATTACHMENT_ID, locator: { page: 3 }, confidence: 0.95 },
        { field: 'noise', value: '???', sourceRef: ATTACHMENT_ID, locator: { page: 3 }, confidence: 0.1 },
      ],
    })

    const { bundle } = await resolver.assemble(
      em(),
      baseInput({ documentExtractions: [extraction] }) as never,
    )

    const routed = bundle.routedSources as ContextRoutedSource[]
    const documentRouted = routed.filter((source) => source.kind === 'document')
    // Only the high-confidence fact is routed; the low-confidence one is excluded.
    expect(documentRouted).toHaveLength(1)
    expect(documentRouted[0].locator).toBe('page:3')
    expect(documentRouted[0].score).toBe(0.95)
  })

  it('degrades to no document facts when no ingest service is registered and no documents are supplied', async () => {
    const container = fakeContainer({
      fixtures: { [MANDATORY_ENTITY]: [{ id: 'subject-1', title: 'subj' }] },
    })
    const resolver = new ContextResolverImpl(container)

    const { bundle } = await resolver.assemble(em(), baseInput() as never)
    const routed = bundle.routedSources as ContextRoutedSource[]
    expect(routed.some((source) => source.kind === 'document')).toBe(false)
  })
})

function em(): EntityManager {
  return createFakeEm().em
}
