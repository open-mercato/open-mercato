import { randomUUID } from 'node:crypto'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormVersionCompiler } from '../services/form-version-compiler'
import {
  SubmissionService,
  SubmissionServiceError,
} from '../services/submission-service'
import { RolePolicyService } from '../services/role-policy-service'
import {
  Form,
  FormSubmission,
  FormSubmissionActor,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import { FormsEncryptionService } from '../services/encryption-service'

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const TENANT_ID = '00000000-0000-0000-0000-000000000222'
const FORM_KEY = 'medical_intake'

type Row = Record<string, unknown> & { id: string }

const baseSchema = () => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient', 'clinician'],
  'x-om-default-actor-role': 'patient',
  properties: {
    full_name: {
      type: 'string',
      minLength: 1,
      'x-om-type': 'text',
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['patient', 'clinician', 'admin'],
    },
    diagnosis: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-editable-by': ['clinician'],
      'x-om-visible-to': ['clinician', 'admin'],
    },
  },
  additionalProperties: false,
})

class FakeEntityManager {
  private tables = new Map<string, Row[]>()

  create<T>(entity: { name: string }, data: Record<string, unknown>): T {
    const id = (data.id as string | undefined) ?? randomUUID()
    const row = {
      id,
      ...data,
      // keep references stable so tests can mutate via the same proxy
    } as Row
    return row as unknown as T
  }

  persist(row: Row | Row[]): void {
    const rows = Array.isArray(row) ? row : [row]
    for (const entry of rows) this.persistOne(entry)
  }

  private persistOne(row: Row) {
    const table = this.tableForRow(row)
    const list = this.tables.get(table) ?? []
    const idx = list.findIndex((entry) => entry.id === row.id)
    if (idx >= 0) list[idx] = row
    else list.push(row)
    this.tables.set(table, list)
  }

  private tableForRow(row: Row): string {
    if ('keyVersion' in row && 'wrappedDek' in row) return 'forms_encryption_key'
    if ('subjectType' in row && 'subjectId' in row) return 'forms_form_submission'
    if ('userId' in row && 'role' in row && 'submissionId' in row) return 'forms_form_submission_actor'
    if ('revisionNumber' in row) return 'forms_form_submission_revision'
    if ('versionNumber' in row && 'schema' in row) return 'forms_form_version'
    if ('key' in row && 'defaultLocale' in row) return 'forms_form'
    return 'unknown'
  }

  async flush(): Promise<void> {
    // No-op — persist already writes to the in-memory store.
  }

  async findOne<T>(
    entity: { name: string },
    where: Record<string, unknown>,
    opts?: { orderBy?: Record<string, 'asc' | 'desc'>; lockMode?: unknown },
  ): Promise<T | null> {
    void opts?.lockMode
    const table = this.entityToTable(entity.name)
    const list = this.tables.get(table) ?? []
    const matches = list.filter((row) => match(row, where))
    if (opts?.orderBy) {
      const [key, dir] = Object.entries(opts.orderBy)[0]
      matches.sort((a, b) => {
        const av = a[key] as number
        const bv = b[key] as number
        return dir === 'desc' ? bv - av : av - bv
      })
    }
    return (matches[0] as unknown as T) ?? null
  }

  async find<T>(
    entity: { name: string },
    where: Record<string, unknown>,
    opts?: { orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<T[]> {
    const table = this.entityToTable(entity.name)
    const list = this.tables.get(table) ?? []
    const matches = list.filter((row) => match(row, where))
    if (opts?.orderBy) {
      const [key, dir] = Object.entries(opts.orderBy)[0]
      matches.sort((a, b) => {
        const av = a[key] as number
        const bv = b[key] as number
        return dir === 'desc' ? bv - av : av - bv
      })
    }
    return matches as unknown as T[]
  }

  async findAndCount<T>(
    entity: { name: string },
    where: Record<string, unknown>,
    opts?: { orderBy?: Record<string, 'asc' | 'desc'>; limit?: number; offset?: number },
  ): Promise<[T[], number]> {
    const all = await this.find<T>(entity, where, opts)
    const offset = opts?.offset ?? 0
    const limit = opts?.limit ?? all.length
    return [all.slice(offset, offset + limit), all.length]
  }

  async transactional<T>(callback: (trx: FakeEntityManager) => Promise<T>): Promise<T> {
    return callback(this)
  }

  private entityToTable(name: string): string {
    if (name === 'Form') return 'forms_form'
    if (name === 'FormVersion') return 'forms_form_version'
    if (name === 'FormSubmission') return 'forms_form_submission'
    if (name === 'FormSubmissionActor') return 'forms_form_submission_actor'
    if (name === 'FormSubmissionRevision') return 'forms_form_submission_revision'
    if (name === 'FormsEncryptionKey') return 'forms_encryption_key'
    return 'unknown'
  }
}

function match(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === 'object' && '$in' in value) {
      const list = (value as { $in: unknown[] }).$in
      if (!list.includes(row[key])) return false
      continue
    }
    if (value === null) {
      if (row[key] !== null && row[key] !== undefined) return false
      continue
    }
    if (row[key] !== value) return false
  }
  return true
}

function createTestSetup(options?: { autosaveIntervalMs?: number; revisionCap?: number; nowSequence?: number[] }) {
  process.env.FORMS_ENCRYPTION_KMS_KEY_ID = 'test-kms'
  const em = new FakeEntityManager()

  const formId = randomUUID()
  const formVersionId = randomUUID()
  em.persist({
    id: formId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key: FORM_KEY,
    name: 'Medical Intake',
    description: null,
    status: 'active',
    currentPublishedVersionId: formVersionId,
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdBy: randomUUID(),
    archivedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Row)

  em.persist({
    id: formVersionId,
    formId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    versionNumber: 1,
    status: 'published',
    schema: baseSchema(),
    uiSchema: {},
    roles: ['admin', 'patient', 'clinician'],
    schemaHash: 'hash',
    registryVersion: 'v1:test',
    publishedAt: new Date(),
    publishedBy: randomUUID(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  } as Row)

  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })
  const rolePolicyService = new RolePolicyService()
  const encryptionService = new FormsEncryptionService({
    emFactory: () => em as unknown as never,
  })

  let nowCounter = 0
  const nowSequence = options?.nowSequence ?? null
  const now = () => {
    if (!nowSequence) return new Date()
    const value = nowSequence[Math.min(nowCounter, nowSequence.length - 1)]
    nowCounter += 1
    return new Date(value)
  }

  const events: Array<{ id: string; payload: unknown }> = []
  const service = new SubmissionService({
    emFactory: () => em as unknown as never,
    formVersionCompiler: compiler,
    encryptionService,
    rolePolicyService,
    emitEvent: async (id, payload) => {
      events.push({ id, payload })
    },
    now,
    autosaveIntervalMs: options?.autosaveIntervalMs ?? 10_000,
    revisionCap: options?.revisionCap ?? 10_000,
  })

  return { em, service, events, formId, formVersionId, encryptionService }
}

describe('SubmissionService', () => {
  it('starts a submission, assigns the default actor role, and emits started event', async () => {
    const { service, events } = createTestSetup()
    const startedBy = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy,
    })
    expect(view.submission.status).toBe('draft')
    expect(view.actors).toHaveLength(1)
    expect(view.actors[0].role).toBe('patient')
    expect(view.revision.revisionNumber).toBe(1)
    expect(events.some((event) => event.id === 'forms.submission.started')).toBe(true)
  })

  it('rejects PATCH with stale base_revision_id (409)', async () => {
    const { service } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    await expect(service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: '00000000-0000-0000-0000-000000000000',
      patch: { full_name: 'Jane' },
      savedBy: patient,
    })).rejects.toMatchObject({ code: 'STALE_BASE', httpStatus: 409 })
  })

  it('drops patch fields outside the actor editable set and emits a tampering marker', async () => {
    const warnLogs: Array<{ payload: Record<string, unknown>; message?: string }> = []
    const { service, em, formId, formVersionId } = createTestSetup({ autosaveIntervalMs: 0 })
    void formId; void formVersionId
    // Replace the service logger by accessing its internals — simpler in test
    ;(service as unknown as { logger: { warn: (p: Record<string, unknown>, m?: string) => void } }).logger = {
      info: () => {},
      warn: (payload, message) => warnLogs.push({ payload, message }),
      error: () => {},
    }

    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    const outcome = await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane', diagnosis: 'should-be-dropped' },
      savedBy: patient,
    })

    expect(outcome.coalesced).toBe(false)
    expect(outcome.revision.changedFieldKeys).toEqual(['full_name'])
    expect(warnLogs).toHaveLength(1)
    expect(warnLogs[0].payload).toMatchObject({
      event: 'forms.security.tampering_marker',
      droppedFieldKeys: ['diagnosis'],
      role: 'patient',
    })
    void em
  })

  it('rejects rapid PATCHes with 429 RATE_LIMITED', async () => {
    let counter = 0
    const sequence = [0, 1000, 2000, 3000] // saves at +1s and +2s — both inside autosave interval
    const { service } = createTestSetup({
      autosaveIntervalMs: 10_000,
      nowSequence: sequence.map((entry) => Date.parse('2026-05-08T00:00:00Z') + entry),
    })
    void counter

    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    // First save — uses next now() entry, elapsed = +1s; min interval = 5s → rate limited.
    await expect(service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane' },
      savedBy: patient,
    })).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 })
  })

  it('returns 422 VALIDATION_FAILED when merged payload violates the schema', async () => {
    const { service } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    // full_name has minLength=1 → empty string fails AJV
    await expect(service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: '' },
      savedBy: patient,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 422 })
  })

  it('coalesces revisions in place after the cap is reached', async () => {
    const { service, em } = createTestSetup({ autosaveIntervalMs: 0, revisionCap: 3 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    let baseRevisionId = view.revision.id
    // Save 1 → revision 2; save 2 → revision 3 (== cap); save 3 → coalesce on revision 3.
    for (let i = 0; i < 2; i += 1) {
      const outcome = await service.save({
        submissionId: view.submission.id,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        baseRevisionId,
        patch: { full_name: `Jane ${i}` },
        savedBy: patient,
      })
      expect(outcome.coalesced).toBe(false)
      baseRevisionId = outcome.revision.id
    }

    const coalesce = await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId,
      patch: { full_name: 'Jane Final' },
      savedBy: patient,
    })
    expect(coalesce.coalesced).toBe(true)

    const revisions = await em.find<FormSubmissionRevision>({ name: 'FormSubmissionRevision' } as never, {
      submissionId: view.submission.id,
    })
    expect(revisions).toHaveLength(3)
    const sorted = revisions.sort((a, b) => (a.revisionNumber as number) - (b.revisionNumber as number))
    expect(sorted[sorted.length - 1].changeSource).toBe('system')
  })

  it('refuses save when the user has no active actor row (403 NO_ACTOR)', async () => {
    const { service, em } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    const otherUser = randomUUID()
    await expect(service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane' },
      savedBy: otherUser,
    })).rejects.toMatchObject({ code: 'NO_ACTOR', httpStatus: 403 })
    void em
  })

  it('refuses cross-tenant access by returning 404 NOT_FOUND', async () => {
    const { service } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    const foreignTenant = randomUUID()
    await expect(service.getCurrent({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: foreignTenant,
    })).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 })
  })

  it('survives encryption rotation mid-submission and decrypts old + new revisions', async () => {
    const { service, em, encryptionService: encryption } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })
    const after1 = await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane' },
      savedBy: patient,
    })
    await encryption.rotate(ORG_ID)
    const after2 = await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: after1.revision.id,
      patch: { full_name: 'Jane V2' },
      savedBy: patient,
    })

    const v1 = await em.findOne<FormSubmissionRevision>({ name: 'FormSubmissionRevision' } as never, { id: after1.revision.id })
    const v2 = await em.findOne<FormSubmissionRevision>({ name: 'FormSubmissionRevision' } as never, { id: after2.revision.id })
    if (!v1 || !v2) throw new Error('expected revisions')
    expect(v1.encryptionKeyVersion).toBe(1)
    expect(v2.encryptionKeyVersion).toBe(2)

    const plain1 = await encryption.decrypt(ORG_ID, v1.data as Buffer)
    const plain2 = await encryption.decrypt(ORG_ID, v2.data as Buffer)
    expect(JSON.parse(plain1.toString('utf8'))).toEqual({ full_name: 'Jane' })
    expect(JSON.parse(plain2.toString('utf8'))).toEqual({ full_name: 'Jane V2' })
  })

  it('marks submission as submitted and emits forms.submission.submitted', async () => {
    const { service, events } = createTestSetup({ autosaveIntervalMs: 0 })
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })

    const after = await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane' },
      savedBy: patient,
    })

    const submitted = await service.submit({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: after.revision.id,
      submittedBy: patient,
      submitMetadata: { locale: 'en' },
    })

    expect(submitted.status).toBe('submitted')
    expect(events.some((event) => event.id === 'forms.submission.submitted')).toBe(true)
  })

  it('redacts sensitive log payloads via tampering marker (no raw values)', async () => {
    const warnLogs: Array<Record<string, unknown>> = []
    const { service } = createTestSetup({ autosaveIntervalMs: 0 })
    ;(service as unknown as { logger: { warn: (p: Record<string, unknown>, m?: string) => void; info: () => void; error: () => void } }).logger = {
      info: () => {},
      warn: (payload) => warnLogs.push(payload),
      error: () => {},
    }
    const patient = randomUUID()
    const subjectId = randomUUID()
    const view = await service.start({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formKey: FORM_KEY,
      subjectType: 'patient',
      subjectId,
      startedBy: patient,
    })
    await service.save({
      submissionId: view.submission.id,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      baseRevisionId: view.revision.id,
      patch: { full_name: 'Jane', diagnosis: 'severe peanut allergy' },
      savedBy: patient,
    })
    expect(warnLogs).toHaveLength(1)
    const captured = JSON.stringify(warnLogs[0])
    // Tampering marker MUST not include the offending value (the diagnosis text).
    expect(captured).not.toContain('peanut')
  })
})

describe('SubmissionServiceError', () => {
  it('preserves code, status, and details', () => {
    const error = new SubmissionServiceError('STALE_BASE', 'stale', 409, { foo: 'bar' })
    expect(error.code).toBe('STALE_BASE')
    expect(error.httpStatus).toBe(409)
    expect(error.details).toEqual({ foo: 'bar' })
  })
})

// Make sure unused imports don't trip ts-jest in strict mode
void Form
void FormVersion
void FormSubmission
void FormSubmissionActor
