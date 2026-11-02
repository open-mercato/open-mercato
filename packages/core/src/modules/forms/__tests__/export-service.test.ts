import { ExportService, ExportServiceError } from '../services/export-service'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormsEncryptionService, DevDeterministicKmsAdapter } from '../services/encryption-service'
import {
  Form,
  FormAttachment,
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
  FormsEncryptionKey,
} from '../data/entities'

class StubEntityManager {
  rows: Map<unknown, unknown[]> = new Map()

  async findOne<T>(EntityClass: new () => T, where: Partial<T>): Promise<T | null> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    const match = list.find((row) => matches(row, where))
    return match ?? null
  }

  async find<T>(
    EntityClass: new () => T,
    where: Partial<T>,
    options?: { orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<T[]> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    let filtered = list.filter((row) => matches(row, where))
    if (options?.orderBy) {
      const [[field, direction]] = Object.entries(options.orderBy)
      filtered = [...filtered].sort((a, b) => {
        const av = String((a as Record<string, unknown>)[field] ?? '')
        const bv = String((b as Record<string, unknown>)[field] ?? '')
        return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    return filtered
  }

  create<T>(EntityClass: new () => T, data: Partial<T>): T {
    return Object.assign(new EntityClass(), data)
  }

  persist(entity: unknown): void {
    const ctor = (entity as { constructor: new () => unknown }).constructor
    const list = this.rows.get(ctor) ?? []
    list.push(entity)
    this.rows.set(ctor, list)
  }

  async flush(): Promise<void> {
    /* no-op */
  }
}

function matches(row: unknown, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    return (row as Record<string, unknown>)[key] === value
  })
}

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000ff'
const FORM_ID = '00000000-0000-0000-0000-000000000020'
const FORM_VERSION_ID = '00000000-0000-0000-0000-000000000011'
const SUBMISSION_ID = '00000000-0000-0000-0000-000000000010'
const SUBJECT_ID = '00000000-0000-0000-0000-000000000030'

const SCHEMA = {
  type: 'object',
  'x-om-roles': ['patient'],
  'x-om-default-actor-role': 'patient',
  properties: {
    full_name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name', pl: 'Imię i nazwisko' },
      'x-om-editable-by': ['patient'],
    },
    ssn: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-label': { en: 'Social security number' },
      'x-om-sensitive': true,
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

async function buildHarness() {
  const em = new StubEntityManager()
  const encryption = new FormsEncryptionService({
    emFactory: () => em as never,
    kmsAdapter: new DevDeterministicKmsAdapter('test-kms-key'),
  })
  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })

  em.rows.set(Form, [
    em.create(Form, {
      id: FORM_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      key: 'intake',
      name: 'Patient intake',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl'],
      status: 'active',
      deletedAt: null,
    }),
  ])

  em.rows.set(FormVersion, [
    em.create(FormVersion, {
      id: FORM_VERSION_ID,
      formId: FORM_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      versionNumber: 3,
      status: 'published',
      schema: SCHEMA,
      uiSchema: {},
      roles: ['patient'],
      schemaHash: 'test-hash',
      registryVersion: defaultFieldTypeRegistry.getRegistryVersion(),
      updatedAt: new Date('2026-05-08T10:00:00Z'),
    }),
  ])

  em.rows.set(FormSubmission, [
    em.create(FormSubmission, {
      id: SUBMISSION_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      formVersionId: FORM_VERSION_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
      status: 'submitted',
      currentRevisionId: 'rev-1',
      startedBy: 'starter',
      firstSavedAt: new Date('2026-05-10T09:00:00Z'),
      submittedAt: new Date('2026-05-10T10:00:00Z'),
      updatedAt: new Date('2026-05-10T10:00:00Z'),
      anonymizedAt: null,
      deletedAt: null,
    }),
  ])

  const answers = {
    full_name: 'Jane Doe',
    ssn: '123-45-6789',
    consent: {
      mode: 'drawn',
      image: 'data:image/png;base64,VERYLONGBLOB',
      affirmed: true,
      signedAt: '2026-05-10T10:00:00Z',
      clauseSha256: 'a'.repeat(64),
    },
  }
  const ciphertext = await encryption.encrypt(ORG_ID, Buffer.from(JSON.stringify(answers), 'utf-8'))
  em.rows.set(FormSubmissionRevision, [
    em.create(FormSubmissionRevision, {
      id: 'rev-1',
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      revisionNumber: 5,
      data: ciphertext,
      encryptionKeyVersion: 1,
      savedBy: 'starter',
      savedByRole: 'patient',
      changeSource: 'user',
      changedFieldKeys: ['full_name', 'ssn', 'consent'],
    }),
  ])

  em.rows.set(FormAttachment, [
    em.create(FormAttachment, {
      id: '00000000-0000-0000-0000-0000000000a1',
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      fieldKey: 'consent',
      kind: 'snapshot',
      filename: 'consent.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      removedAt: null,
    }),
  ])

  em.rows.set(FormsEncryptionKey, [])

  return { em, encryption, compiler }
}

function buildService(harness: { em: StubEntityManager; encryption: FormsEncryptionService; compiler: FormVersionCompiler }) {
  return new ExportService({
    emFactory: () => harness.em as never,
    compiler: harness.compiler,
    encryption: harness.encryption,
    now: () => new Date('2026-05-21T00:00:00Z'),
  })
}

describe('ExportService.exportSubject', () => {
  it('builds a structured document with labels, decrypted answers and signature metadata', async () => {
    const harness = await buildHarness()
    const service = buildService(harness)

    const { document, submissionIds } = await service.exportSubject({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
    })

    expect(submissionIds).toEqual([SUBMISSION_ID])
    expect(document.submissionCount).toBe(1)
    const submission = document.submissions[0]
    expect(submission.formKey).toBe('intake')
    expect(submission.formName).toBe('Patient intake')
    expect(submission.versionNumber).toBe(3)
    expect(submission.status).toBe('submitted')
    expect(submission.currentRevisionNumber).toBe(5)

    const byKey = Object.fromEntries(submission.answers.map((entry) => [entry.fieldKey, entry]))
    expect(byKey.full_name.label).toBe('Full name')
    expect(byKey.full_name.value).toBe('Jane Doe')
    expect(byKey.ssn.sensitive).toBe(true)
    expect(byKey.ssn.value).toBe('123-45-6789')

    // Signature metadata is surfaced; the raw image blob is stripped.
    expect(byKey.consent.type).toBe('signature')
    expect(byKey.consent.signature).toEqual({
      mode: 'drawn',
      signedAt: '2026-05-10T10:00:00Z',
      clauseSha256: 'a'.repeat(64),
      typedName: null,
      hasImage: true,
    })
    expect((byKey.consent.value as Record<string, unknown>).image).toBeUndefined()
    expect((byKey.consent.value as Record<string, unknown>).clauseSha256).toBe('a'.repeat(64))

    // Attachments referenced by id, never inlined.
    expect(submission.attachments).toEqual([
      {
        attachmentId: '00000000-0000-0000-0000-0000000000a1',
        fieldKey: 'consent',
        kind: 'snapshot',
        filename: 'consent.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      },
    ])
  })

  it('resolves locale-specific labels when a locale is supplied', async () => {
    const harness = await buildHarness()
    const service = buildService(harness)
    const { document } = await service.exportSubject({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
      locale: 'pl',
    })
    const fullName = document.submissions[0].answers.find((entry) => entry.fieldKey === 'full_name')
    expect(fullName?.label).toBe('Imię i nazwisko')
  })

  it('is tenant/org scoped — a foreign org sees no submissions', async () => {
    const harness = await buildHarness()
    const service = buildService(harness)
    const { document, submissionIds } = await service.exportSubject({
      organizationId: OTHER_ORG_ID,
      tenantId: TENANT_ID,
      subjectType: 'patient',
      subjectId: SUBJECT_ID,
    })
    expect(submissionIds).toEqual([])
    expect(document.submissionCount).toBe(0)
  })
})

describe('ExportService.exportSubmission', () => {
  it('exports a single submission scoped by org+tenant', async () => {
    const harness = await buildHarness()
    const service = buildService(harness)
    const { document, submissionIds } = await service.exportSubmission({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: SUBMISSION_ID,
    })
    expect(submissionIds).toEqual([SUBMISSION_ID])
    expect(document.submissionId).toBe(SUBMISSION_ID)
    expect(document.answers.length).toBe(3)
  })

  it('throws when the submission is out of tenant scope', async () => {
    const harness = await buildHarness()
    const service = buildService(harness)
    await expect(
      service.exportSubmission({
        organizationId: OTHER_ORG_ID,
        tenantId: TENANT_ID,
        submissionId: SUBMISSION_ID,
      }),
    ).rejects.toBeInstanceOf(ExportServiceError)
  })
})
