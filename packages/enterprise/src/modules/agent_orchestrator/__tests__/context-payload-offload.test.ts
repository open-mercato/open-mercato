import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import {
  ContextResolverImpl,
  CONTEXT_PAYLOAD_REF_MAX_LENGTH,
  type AssembleContentCapture,
} from '../lib/context/contextResolver'
import {
  registerContextModule,
  entityProvenance,
  retrievalProvenance,
  type ContextModule,
} from '../lib/context/registry'
import { contextBundleRoutedSourcesSchema } from '../data/validators'
import { AGENT_TRACE_CONTENT_NAMESPACE } from '../lib/trace/artifactStore'
import { CONTEXT_PAYLOAD_ARTIFACT_SCHEMA, buildContextPayloadArtifact } from '../lib/trace/contentCapture'

type UploadCall = { namespace: string; fileName: string; buffer: Buffer; scope: Record<string, unknown> }

function createFakeEm() {
  const rows: Array<Record<string, unknown>> = []
  const pending: Array<Record<string, unknown>> = []
  const em = {
    create(_entity: unknown, data: Record<string, unknown>) {
      return { ...data }
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      rows.push(...pending.splice(0))
    },
  }
  return { em: em as unknown as EntityManager, rows }
}

type StorageMode = 'ok' | 'throws' | 'absent' | 'long-key'

function fakeContainer(storage: StorageMode, uploads: UploadCall[]): AwilixContainer {
  const queryEngine: QueryEngine = {
    async query<T = unknown>(entity: string, _opts: QueryOptions = {}): Promise<QueryResult<T>> {
      const fixtures: Record<string, Array<Record<string, unknown>>> = {
        [SUBJECT_ENTITY]: [
          {
            id: 'subject-1',
            title: 'Renewal for alice@example.com',
            note: 'Authorization: Bearer sk-live-abcdefghijklmnop',
            email: 'bob@example.com',
          },
        ],
      }
      const items = (fixtures[entity] ?? []) as unknown as T[]
      return { items, page: 1, pageSize: 100, total: items.length }
    },
  }
  const searchService = {
    async search(): Promise<unknown[]> {
      return [
        { entityId: RETRIEVAL_ENTITY, recordId: 'doc-1', score: 0.9, presenter: { title: 'Renewal policy' } },
        { entityId: RETRIEVAL_ENTITY, recordId: 'doc-2', score: 0.4, presenter: { title: 'Prior note' } },
      ]
    },
  }
  const storageService = {
    async _resolveService() {
      return {
        async upload(input: UploadCall) {
          if (storage === 'throws') throw new Error('[internal] storage down')
          uploads.push(input)
          return { key: storage === 'long-key' ? `k/${'x'.repeat(CONTEXT_PAYLOAD_REF_MAX_LENGTH)}` : `org/${input.fileName}` }
        },
      }
    },
  }
  const registered = new Set(['queryEngine', 'searchService', ...(storage === 'absent' ? [] : ['storageService'])])
  return {
    hasRegistration(name: string) {
      return registered.has(name)
    },
    resolve(name: string) {
      if (name === 'queryEngine') return queryEngine
      if (name === 'searchService') return searchService
      if (name === 'storageService' && storage !== 'absent') return storageService
      throw new Error(`[internal] unexpected resolve("${name}") in test`)
    },
  } as unknown as AwilixContainer
}

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const RUN_ID = '55555555-5555-5555-5555-555555555555'
const CAPABILITY = 'test.payload.capability'
const SUBJECT_ENTITY = 'test:payload_subject'
const RETRIEVAL_ENTITY = 'test:payload_doc'

const TEST_MODULE: ContextModule = {
  capability: CAPABILITY,
  sources: [
    {
      kind: 'entity',
      tier: 'mandatory',
      entityType: SUBJECT_ENTITY,
      priority: 0,
      fields: ['id', 'title', 'note', 'email'],
      provenance: entityProvenance(SUBJECT_ENTITY),
    },
    {
      kind: 'retrieval',
      tier: 'optional',
      entityType: RETRIEVAL_ENTITY,
      entityTypes: [RETRIEVAL_ENTITY],
      priority: 10,
      fields: [],
      limit: 5,
      provenance: retrievalProvenance(),
    },
  ],
}

beforeAll(() => {
  registerContextModule(TEST_MODULE)
})

function input(contentCapture?: AssembleContentCapture) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    agentRunId: RUN_ID,
    workflowInstanceId: null,
    stepId: null,
    capability: CAPABILITY,
    budget: 4000,
    ...(contentCapture ? { contentCapture } : {}),
  }
}

function uploadedPayload(upload: UploadCall): Record<string, unknown> {
  const wrapper = JSON.parse(upload.buffer.toString('utf8')) as { input: string }
  return JSON.parse(wrapper.input) as Record<string, unknown>
}

describe('ContextResolverImpl.assemble context payload offload', () => {
  it.each(['off', 'metadata'] as const)('stores no payload at the %s level', async (level) => {
    const uploads: UploadCall[] = []
    const { em, rows } = createFakeEm()
    const resolver = new ContextResolverImpl(fakeContainer('ok', uploads))
    const result = await resolver.assemble(em, input({ level, redactPii: false }))
    expect(result.payloadRef).toBeNull()
    expect(rows[0].payloadRef).toBeNull()
    expect(uploads).toHaveLength(0)
  })

  it('stores no payload when no content capture is given', async () => {
    const uploads: UploadCall[] = []
    const { em } = createFakeEm()
    const result = await new ContextResolverImpl(fakeContainer('ok', uploads)).assemble(em, input())
    expect(result.payloadRef).toBeNull()
    expect(uploads).toHaveLength(0)
  })

  it('offloads the redacted packed payload at full and sets payloadRef', async () => {
    const uploads: UploadCall[] = []
    const { em, rows } = createFakeEm()
    const resolver = new ContextResolverImpl(fakeContainer('ok', uploads))
    const result = await resolver.assemble(em, input({ level: 'full', redactPii: false }))

    expect(uploads).toHaveLength(1)
    expect(uploads[0].namespace).toBe(AGENT_TRACE_CONTENT_NAMESPACE)
    expect(uploads[0].scope).toEqual({ tenantId: TENANT, organizationId: ORG })
    expect(result.payloadRef).toBe(`org/${uploads[0].fileName}`)
    expect(rows[0].payloadRef).toBe(result.payloadRef)

    const payload = uploadedPayload(uploads[0])
    expect(payload.schema).toBe(CONTEXT_PAYLOAD_ARTIFACT_SCHEMA)
    expect(payload.capability).toBe(CAPABILITY)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('sk-live-abcdefghijklmnop')
    expect(serialized).not.toContain('bob@example.com')
    expect(serialized).toContain('alice@example.com')

    const records = payload.records as Array<{ kind: string; ref: string }>
    expect(records.map((record) => `${record.kind}:${record.ref}`)).toEqual([
      'entity:subject-1',
      `retrieval:${RETRIEVAL_ENTITY}:doc-1`,
      `retrieval:${RETRIEVAL_ENTITY}:doc-2`,
    ])
    const spans = payload.untrustedSpans as Array<{ sourceRef: string; text: string }>
    expect(spans.map((span) => span.sourceRef)).toEqual([`${RETRIEVAL_ENTITY}:doc-1`, `${RETRIEVAL_ENTITY}:doc-2`])
    const retrieval = payload.retrieval as Array<{ query: string; queryHash: string; k: number }>
    expect(retrieval).toHaveLength(1)
    expect(retrieval[0].query).toContain(CAPABILITY)
    expect(retrieval[0].queryHash).toBe(createHash('sha256').update(retrieval[0].query).digest('hex'))
    expect(retrieval[0].k).toBe(5)
  })

  it('redacts PII strings in the payload when the policy asks for it', async () => {
    const uploads: UploadCall[] = []
    const { em } = createFakeEm()
    await new ContextResolverImpl(fakeContainer('ok', uploads)).assemble(em, input({ level: 'full', redactPii: true }))
    expect(JSON.stringify(uploadedPayload(uploads[0]))).not.toContain('alice@example.com')
  })

  it.each(['throws', 'absent', 'long-key'] as const)(
    'keeps payloadRef null and still persists the bundle when storage is %s',
    async (mode) => {
      const uploads: UploadCall[] = []
      const { em, rows } = createFakeEm()
      const result = await new ContextResolverImpl(fakeContainer(mode, uploads)).assemble(
        em,
        input({ level: 'full', redactPii: false }),
      )
      expect(result.payloadRef).toBeNull()
      expect(rows).toHaveLength(1)
      expect(rows[0].payloadRef).toBeNull()
      expect(result.untrustedSpans).toHaveLength(2)
    },
  )

  it('records the retrieval summary on routed retrieval sources', async () => {
    const { em, rows } = createFakeEm()
    await new ContextResolverImpl(fakeContainer('absent', [])).assemble(em, input())
    const routed = contextBundleRoutedSourcesSchema.parse(rows[0].routedSources)
    const entity = routed.find((source) => source.kind === 'entity')
    expect(entity?.retrieval).toBeUndefined()
    const retrieval = routed.filter((source) => source.kind === 'retrieval')
    expect(retrieval.map((source) => source.retrieval?.rank)).toEqual([1, 2])
    expect(retrieval.every((source) => source.retrieval?.k === 5)).toBe(true)
    expect(new Set(retrieval.map((source) => source.retrieval?.queryHash)).size).toBe(1)
  })
})

describe('buildContextPayloadArtifact', () => {
  it('caps the payload by truncating the largest record first', () => {
    const artifact = buildContextPayloadArtifact(
      {
        capability: CAPABILITY,
        records: [
          { kind: 'entity', ref: 'small', record: { title: 'short' } },
          { kind: 'entity', ref: 'large', record: { body: 'y'.repeat(4000) } },
        ],
        untrustedSpans: [],
        retrieval: [],
      },
      { redactPii: false, maxBytes: 1000 },
    )
    expect(artifact.truncated).toBe(true)
    expect(artifact.bytes).toBeLessThanOrEqual(1000)
    const records = (artifact.payload as { records: Array<{ ref: string; record: Record<string, unknown> }> }).records
    expect(records[0].record).toEqual({ title: 'short' })
    expect(records[1].record).toMatchObject({ _truncated: true })
  })

  it('counts secret redactions', () => {
    const artifact = buildContextPayloadArtifact(
      {
        capability: CAPABILITY,
        records: [{ kind: 'entity', ref: 'r1', record: { apiKey: 'value', note: 'Bearer abcdefghijklmnopqrstu' } }],
        untrustedSpans: [],
        retrieval: [],
      },
      { redactPii: false },
    )
    expect(artifact.redactions.map((entry) => entry.rule)).toEqual(expect.arrayContaining(['secret_key', 'auth_scheme']))
  })
})
