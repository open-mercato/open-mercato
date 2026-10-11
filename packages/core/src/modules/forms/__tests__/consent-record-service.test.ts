import { ConsentRecordService, type ConsentProjectionLoad } from '../services/consent-record-service'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormConsentRecord } from '../data/entities'

class StubEntityManager {
  rows: Map<unknown, unknown[]> = new Map()
  flushCount = 0

  async findOne<T>(EntityClass: new () => T, where: Partial<T>): Promise<T | null> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    return list.find((row) => matches(row, where)) ?? null
  }

  async find<T>(EntityClass: new () => T, where: Partial<T>): Promise<T[]> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    return list.filter((row) => matches(row, where))
  }

  create<T>(EntityClass: new () => T, data: Partial<T>): T {
    const entity = Object.assign(new EntityClass(), data) as T
    ;(entity as Record<string, unknown>).id =
      (data as Record<string, unknown>).id ?? `record-${Math.random().toString(16).slice(2)}`
    return entity
  }

  persist(entity: unknown): void {
    const ctor = (entity as { constructor: new () => unknown }).constructor
    const list = this.rows.get(ctor) ?? []
    if (!list.includes(entity)) list.push(entity)
    this.rows.set(ctor, list)
  }

  async flush(): Promise<void> {
    this.flushCount += 1
  }
}

function matches(row: unknown, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
}

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const FORM_ID = '00000000-0000-0000-0000-000000000020'
const FORM_VERSION_ID = '00000000-0000-0000-0000-000000000011'
const SUBJECT_ID = '00000000-0000-0000-0000-000000000030'
const CLAUSE_SHA = 'a'.repeat(64)
const CLAUSE_SHA_2 = 'b'.repeat(64)

const SCHEMA_WITH_SIGNATURE = {
  type: 'object',
  'x-om-roles': ['patient'],
  'x-om-default-actor-role': 'patient',
  properties: {
    full_name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name' },
      'x-om-editable-by': ['patient'],
    },
    consent: {
      type: 'object',
      'x-om-type': 'signature',
      'x-om-label': { en: 'Consent signature' },
      'x-om-editable-by': ['patient'],
    },
  },
}

const SCHEMA_NO_SIGNATURE = {
  type: 'object',
  'x-om-roles': ['patient'],
  'x-om-default-actor-role': 'patient',
  properties: {
    full_name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name' },
      'x-om-editable-by': ['patient'],
    },
  },
}

function makeLoad(args: {
  submissionId: string
  schema: Record<string, unknown>
  decodedData: Record<string, unknown>
  status?: 'submitted' | 'draft'
}): ConsentProjectionLoad {
  return {
    submission: {
      id: args.submissionId,
      organizationId: ORG_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
      status: args.status ?? 'submitted',
    },
    formVersion: {
      id: FORM_VERSION_ID,
      formId: FORM_ID,
      versionNumber: 2,
      schema: args.schema,
      uiSchema: {},
      updatedAt: new Date('2026-05-08T10:00:00Z'),
    },
    decodedData: args.decodedData,
  }
}

function signedSignature(sha: string, signedAt: string): Record<string, unknown> {
  return { mode: 'typed', typedName: 'Jane Doe', affirmed: true, signedAt, clauseSha256: sha }
}

function buildService(em: StubEntityManager, load: ConsentProjectionLoad | null) {
  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })
  return new ConsentRecordService({
    emFactory: () => em as never,
    compiler,
    loadSubmission: async () => load,
    now: () => new Date('2026-05-21T12:00:00Z'),
  })
}

describe('ConsentRecordService.projectFromSubmission', () => {
  it('creates an active consent record from a signed submission', async () => {
    const em = new StubEntityManager()
    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a1',
      schema: SCHEMA_WITH_SIGNATURE,
      decodedData: { full_name: 'Jane', consent: signedSignature(CLAUSE_SHA, '2026-05-21T11:59:00Z') },
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(1)
    const record = created[0]
    expect(record.status).toBe('active')
    expect(record.consentFieldKey).toBe('consent')
    expect(record.clauseSha256).toBe(CLAUSE_SHA)
    expect(record.formId).toBe(FORM_ID)
    expect(record.versionNumber).toBe(2)
    expect(record.subjectType).toBe('patient')
    expect(record.subjectId).toBe(SUBJECT_ID)
    expect(record.signedAt.toISOString()).toBe('2026-05-21T11:59:00.000Z')
    // PII-free: never stores the typed name or image.
    expect(JSON.stringify(record)).not.toContain('Jane Doe')
    expect(em.flushCount).toBe(1)
  })

  it('supersedes the prior active record for the same subject + form + field', async () => {
    const em = new StubEntityManager()
    const prior = em.create(FormConsentRecord, {
      id: 'prior-record',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
      formId: FORM_ID,
      formVersionId: FORM_VERSION_ID,
      versionNumber: 1,
      submissionId: '00000000-0000-0000-0000-0000000000a0',
      consentFieldKey: 'consent',
      clauseSha256: CLAUSE_SHA,
      signedAt: new Date('2026-01-01T00:00:00Z'),
      status: 'active',
      supersededByRecordId: null,
      supersededAt: null,
    })
    em.persist(prior)

    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a1',
      schema: SCHEMA_WITH_SIGNATURE,
      decodedData: { consent: signedSignature(CLAUSE_SHA_2, '2026-05-21T11:59:00Z') },
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(1)
    expect(prior.status).toBe('superseded')
    expect(prior.supersededByRecordId).toBe(created[0].id)
    expect(prior.supersededAt?.toISOString()).toBe('2026-05-21T12:00:00.000Z')
    expect(created[0].status).toBe('active')
  })

  it('is idempotent on re-delivery (existing record for submission + field)', async () => {
    const em = new StubEntityManager()
    const existing = em.create(FormConsentRecord, {
      id: 'existing-record',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
      formId: FORM_ID,
      formVersionId: FORM_VERSION_ID,
      versionNumber: 2,
      submissionId: '00000000-0000-0000-0000-0000000000a1',
      consentFieldKey: 'consent',
      clauseSha256: CLAUSE_SHA,
      signedAt: new Date('2026-05-21T11:59:00Z'),
      status: 'active',
      supersededByRecordId: null,
      supersededAt: null,
    })
    em.persist(existing)

    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a1',
      schema: SCHEMA_WITH_SIGNATURE,
      decodedData: { consent: signedSignature(CLAUSE_SHA, '2026-05-21T11:59:00Z') },
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(0)
    expect((em.rows.get(FormConsentRecord) ?? []).length).toBe(1)
    expect(em.flushCount).toBe(0)
  })

  it('no-ops when the form has no signature field', async () => {
    const em = new StubEntityManager()
    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a2',
      schema: SCHEMA_NO_SIGNATURE,
      decodedData: { full_name: 'Jane' },
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(0)
    expect(em.rows.get(FormConsentRecord)).toBeUndefined()
  })

  it('no-ops when a signature field is present but unsigned', async () => {
    const em = new StubEntityManager()
    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a3',
      schema: SCHEMA_WITH_SIGNATURE,
      decodedData: { full_name: 'Jane' },
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(0)
  })

  it('no-ops when the submission is not in submitted status', async () => {
    const em = new StubEntityManager()
    const load = makeLoad({
      submissionId: '00000000-0000-0000-0000-0000000000a4',
      schema: SCHEMA_WITH_SIGNATURE,
      decodedData: { consent: signedSignature(CLAUSE_SHA, '2026-05-21T11:59:00Z') },
      status: 'draft',
    })
    const service = buildService(em, load)

    const created = await service.projectFromSubmission({
      submissionId: load.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })

    expect(created).toHaveLength(0)
  })
})
