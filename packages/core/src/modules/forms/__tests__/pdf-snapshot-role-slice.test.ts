/** @jest-environment node */

/**
 * #7229 — the participant PDF holds only the answers the viewer's role can read.
 *
 *   - `buildSnapshotDocument({ ..., visibleFieldKeys })` renders only those keys.
 *   - `PdfSnapshotService.readSnapshotForViewer({ ..., viewerRole })`:
 *       role reading every rendered field -> canonical snapshot (cached, stored once);
 *       role reading a subset            -> uncached role-filtered PDF, nothing persisted;
 *       null / undeclared role           -> no answers (fails closed like getCurrent).
 *   - The visible set matches `SubmissionService.getCurrent` (role policy +
 *     `x-om-visibility-if` evaluated on the full payload).
 */

const createRequestContainer = jest.fn()
const resolveRuntimePrincipal = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../lib/runtime-principal', () => ({
  resolveRuntimePrincipal: (...args: unknown[]) => resolveRuntimePrincipal(...args),
}))

jest.mock('../api/public/rate-limit', () => ({
  buildPublicRateLimitKey: (namespace: string, ...identifiers: string[]) =>
    `${namespace}:${identifiers.join(':')}`,
  enforcePublicRateLimit: async () => null,
}))

import { randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormVersionCompiler } from '../services/form-version-compiler'
import {
  PdfSnapshotService,
  buildSnapshotDocument,
  listSnapshotFieldKeys,
  renderDocumentToPdf,
} from '../services/pdf-snapshot-service'
import type { Form, FormSubmission, FormVersion } from '../data/entities'
import { GET as downloadPublicPdf } from '../api/public/submissions/[id]/pdf/route'

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const TENANT_ID = '00000000-0000-0000-0000-000000000222'
const FORM_ID = '00000000-0000-0000-0000-000000000333'
const VERSION_ID = '00000000-0000-0000-0000-000000000444'
const PATIENT_NAME = 'PATIENTNAMEQX'
const CLINICIAN_NOTE = 'CLINICIANNOTEQX'
const HIDDEN_DETAIL = 'HIDDENDETAILQX'

const INFO_BLOCK = {
  type: 'string',
  'x-om-type': 'info_block',
  'x-om-label': { en: 'Please answer honestly' },
}

const schema = (options: { withInfoBlock?: boolean } = {}) => ({
  type: 'object',
  'x-om-roles': ['admin', 'patient', 'clinician'],
  'x-om-default-actor-role': 'patient',
  properties: {
    ...(options.withInfoBlock ? { intro: INFO_BLOCK } : {}),
    full_name: {
      type: 'string',
      'x-om-type': 'text',
      'x-om-label': { en: 'Full name' },
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['patient', 'clinician', 'admin'],
    },
    has_condition: {
      type: 'boolean',
      'x-om-type': 'boolean',
      'x-om-label': { en: 'Has condition' },
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['patient', 'clinician', 'admin'],
    },
    details: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-label': { en: 'Details' },
      'x-om-editable-by': ['patient'],
      'x-om-visible-to': ['patient', 'clinician', 'admin'],
      'x-om-visibility-if': { '==': [{ var: 'has_condition' }, true] },
    },
    diagnosis: {
      type: 'string',
      'x-om-type': 'textarea',
      'x-om-label': { en: 'Diagnosis' },
      'x-om-editable-by': ['clinician'],
      'x-om-visible-to': ['clinician', 'admin'],
    },
  },
  additionalProperties: false,
})

const answers = {
  full_name: PATIENT_NAME,
  has_condition: false,
  details: HIDDEN_DETAIL,
  diagnosis: CLINICIAN_NOTE,
}

type Row = Record<string, unknown> & { id: string }

class FakeEntityManager {
  readonly tables = new Map<string, Row[]>()
  private readonly created = new WeakMap<object, string>()

  seed(entityName: string, row: Row): void {
    const list = this.tables.get(entityName) ?? []
    list.push(row)
    this.tables.set(entityName, list)
  }

  rows(entityName: string): Row[] {
    return this.tables.get(entityName) ?? []
  }

  create<T>(entity: { name: string }, data: Record<string, unknown>): T {
    const row = { id: (data.id as string | undefined) ?? randomUUID(), ...data } as Row
    this.created.set(row, entity.name)
    return row as unknown as T
  }

  persist(row: Row): void {
    const entityName = this.created.get(row)
    if (!entityName) throw new Error('[internal] persist of an unknown row')
    this.seed(entityName, row)
  }

  async flush(): Promise<void> {}

  async findOne<T>(entity: { name: string }, where: Record<string, unknown>): Promise<T | null> {
    const match = this.rows(entity.name).find((row) =>
      Object.entries(where).every(([key, value]) =>
        value === null ? row[key] === null || row[key] === undefined : row[key] === value,
      ),
    )
    return (match as unknown as T) ?? null
  }
}

const identityEncryption = {
  encrypt: async (_organizationId: string, plain: Buffer) => Buffer.from(plain),
  decrypt: async (_organizationId: string, cipher: Buffer) => Buffer.from(cipher),
}

/** Inflates every PDF stream and returns the decoded text operators as one latin1 string. */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1')
  const chunks: string[] = [raw]
  let cursor = 0
  for (;;) {
    const start = raw.indexOf('stream', cursor)
    if (start < 0) break
    const bodyStart = raw[start + 6] === '\r' ? start + 8 : start + 7
    const end = raw.indexOf('endstream', bodyStart)
    if (end < 0) break
    cursor = end + 9
    try {
      chunks.push(inflateSync(bytes.subarray(bodyStart, end)).toString('latin1'))
    } catch {
      continue
    }
  }
  return chunks.join('\n')
}

function pdfContains(bytes: Buffer, text: string): boolean {
  const decoded = pdfText(bytes)
  const hex = Buffer.from(text, 'latin1').toString('hex')
  return decoded.includes(`(${text})`) || decoded.toLowerCase().includes(`<${hex}>`)
}

function buildFixture(options: { withInfoBlock?: boolean } = {}) {
  const em = new FakeEntityManager()
  const submissionId = randomUUID()
  const revisionId = randomUUID()
  const now = new Date('2026-10-01T10:00:00.000Z')
  em.seed('Form', {
    id: FORM_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key: 'intake',
    name: 'Intake',
    defaultLocale: 'en',
    supportedLocales: ['en'],
  })
  em.seed('FormVersion', {
    id: VERSION_ID,
    formId: FORM_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    versionNumber: 1,
    status: 'published',
    schema: schema({ withInfoBlock: options.withInfoBlock }),
    uiSchema: {},
    schemaHash: 'sha256:test',
    roles: ['admin', 'patient', 'clinician'],
    updatedAt: now,
  })
  em.seed('FormSubmissionRevision', {
    id: revisionId,
    submissionId,
    organizationId: ORG_ID,
    revisionNumber: 3,
    data: Buffer.from(JSON.stringify(answers), 'utf8'),
  })
  em.seed('FormSubmission', {
    id: submissionId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: VERSION_ID,
    subjectType: 'patient',
    subjectId: randomUUID(),
    status: 'submitted',
    currentRevisionId: revisionId,
    submittedBy: randomUUID(),
    submittedAt: now,
    submitMetadata: {},
    pdfSnapshotAttachmentId: null,
    deletedAt: null,
  })
  const emitted: string[] = []
  const service = new PdfSnapshotService({
    emFactory: () => em as never,
    encryptionService: identityEncryption as never,
    formVersionCompiler: new FormVersionCompiler({ registry: defaultFieldTypeRegistry }),
    emitEvent: async (eventId) => {
      emitted.push(eventId)
    },
  })
  return { em, service, submissionId, emitted }
}

function revealDetails(em: FakeEntityManager): void {
  em.rows('FormSubmissionRevision')[0].data = Buffer.from(
    JSON.stringify({ ...answers, has_condition: true }),
    'utf8',
  )
}

describe('buildSnapshotDocument visibleFieldKeys (#7229)', () => {
  it('renders only the keys the viewer may read', () => {
    const doc = buildSnapshotDocument({
      form: { id: FORM_ID, name: 'Intake', defaultLocale: 'en' } as unknown as Form,
      formVersion: {
        id: VERSION_ID,
        versionNumber: 1,
        schema: schema(),
        schemaHash: 'sha256:test',
      } as unknown as FormVersion,
      submission: {
        id: randomUUID(),
        organizationId: ORG_ID,
        submittedAt: new Date(),
        submitMetadata: {},
      } as unknown as FormSubmission,
      answers,
      visibleFieldKeys: new Set(['full_name', 'has_condition']),
    })
    const keys = doc.sections.flatMap((section) => section.fields.map((field) => field.key))
    expect(keys).toEqual(expect.arrayContaining(['full_name', 'has_condition']))
    expect(keys).not.toContain('diagnosis')
    expect(keys).not.toContain('details')
  })

  it('filters sectioned fields and signature evidence, dropping a section left without visible fields', () => {
    const sectioned = {
      ...schema(),
      'x-om-sections': [
        { key: 'patient', title: { en: 'Patient' }, fieldKeys: ['full_name'] },
        { key: 'clinical', title: { en: 'Clinical' }, fieldKeys: ['diagnosis', 'clinician_signature'] },
      ],
      properties: {
        ...schema().properties,
        clinician_signature: {
          type: 'object',
          'x-om-type': 'signature',
          'x-om-label': { en: 'Clinician signature' },
          'x-om-editable-by': ['clinician'],
          'x-om-visible-to': ['clinician', 'admin'],
        },
      },
    }
    const buildFor = (visibleFieldKeys?: ReadonlySet<string>) =>
      buildSnapshotDocument({
        form: { id: FORM_ID, name: 'Intake', defaultLocale: 'en' } as unknown as Form,
        formVersion: { id: VERSION_ID, versionNumber: 1, schema: sectioned, schemaHash: 'h' } as unknown as FormVersion,
        submission: { id: 's', organizationId: ORG_ID, submitMetadata: {} } as unknown as FormSubmission,
        answers: {
          ...answers,
          clinician_signature: {
            mode: 'typed',
            typedName: 'Dr Clinician',
            clauseSha256: 'a'.repeat(64),
            signedAt: '2026-10-01T10:00:00.000Z',
          },
        },
        visibleFieldKeys,
      })

    const full = buildFor()
    expect(full.sections.map((section) => section.key)).toEqual(['patient', 'clinical', '__fields__'])
    const fullSignature = full.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'clinician_signature')
    expect(fullSignature?.signature?.typedName).toBe('Dr Clinician')

    const sliced = buildFor(new Set(['full_name', 'has_condition']))
    expect(sliced.sections.map((section) => section.key)).toEqual(['patient', '__fields__'])
    const slicedKeys = sliced.sections.flatMap((section) => section.fields.map((field) => field.key))
    expect(slicedKeys).toEqual(['full_name', 'has_condition'])
  })

  it('lists every rendered field key and skips layout types such as info_block', () => {
    expect(listSnapshotFieldKeys(schema({ withInfoBlock: true }), defaultFieldTypeRegistry)).toEqual([
      'full_name',
      'has_condition',
      'details',
      'diagnosis',
    ])
  })
})

describe('PdfSnapshotService.readSnapshotForViewer (#7229)', () => {
  it('self-check: the PDF text probe sees answers rendered by renderDocumentToPdf', async () => {
    const doc = buildSnapshotDocument({
      form: { id: FORM_ID, name: 'Intake', defaultLocale: 'en' } as unknown as Form,
      formVersion: { id: VERSION_ID, versionNumber: 1, schema: schema(), schemaHash: 'h' } as unknown as FormVersion,
      submission: { id: 's', organizationId: ORG_ID, submitMetadata: {} } as unknown as FormSubmission,
      answers,
    })
    const bytes = await renderDocumentToPdf(doc)
    expect(pdfContains(bytes, CLINICIAN_NOTE)).toBe(true)
    expect(pdfContains(bytes, 'NOTPRESENTQX')).toBe(false)
  })

  it('gives a role-limited participant an uncached PDF with only role-visible answers', async () => {
    const { em, service, submissionId, emitted } = buildFixture()

    const result = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'patient',
    })

    expect(result.contentType).toBe('application/pdf')
    expect(pdfContains(result.bytes, PATIENT_NAME)).toBe(true)
    expect(pdfContains(result.bytes, CLINICIAN_NOTE)).toBe(false)
    expect(pdfContains(result.bytes, HIDDEN_DETAIL)).toBe(false)
    expect(result.attachmentId).toBeNull()
    expect(em.rows('FormAttachment')).toHaveLength(0)
    expect(em.rows('FormSubmission')[0].pdfSnapshotAttachmentId).toBeNull()
    expect(emitted).toHaveLength(0)
  })

  it('does not serve a previously generated canonical snapshot to a role-limited participant', async () => {
    const { em, service, submissionId } = buildFixture()
    const canonical = await service.ensureSnapshot({ organizationId: ORG_ID, tenantId: TENANT_ID, submissionId })
    expect(pdfContains(canonical.bytes, CLINICIAN_NOTE)).toBe(true)

    const result = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'patient',
    })

    expect(pdfContains(result.bytes, CLINICIAN_NOTE)).toBe(false)
    expect(result.attachmentId).toBeNull()
    expect(em.rows('FormAttachment')).toHaveLength(1)
    expect(em.rows('FormSubmission')[0].pdfSnapshotAttachmentId).toBe(canonical.attachmentId)
  })

  it('renders no answers at all for a null or undeclared role (fails closed like getCurrent)', async () => {
    const { em, service, submissionId } = buildFixture()
    for (const viewerRole of [null, 'not-a-declared-role']) {
      const result = await service.readSnapshotForViewer({
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        submissionId,
        viewerRole,
      })
      expect(pdfContains(result.bytes, PATIENT_NAME)).toBe(false)
      expect(pdfContains(result.bytes, CLINICIAN_NOTE)).toBe(false)
    }
    expect(em.rows('FormAttachment')).toHaveLength(0)
  })

  it('serves the canonical snapshot (and stores it lazily) when the role reads every rendered field', async () => {
    const { em, service, submissionId } = buildFixture()
    const submission = em.rows('FormSubmission')[0]
    revealDetails(em)

    const result = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'clinician',
    })

    expect(pdfContains(result.bytes, CLINICIAN_NOTE)).toBe(true)
    expect(pdfContains(result.bytes, HIDDEN_DETAIL)).toBe(true)
    expect(result.attachmentId).toBe(submission.pdfSnapshotAttachmentId)
    expect(em.rows('FormAttachment')).toHaveLength(1)

    const again = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'clinician',
    })
    expect(again.bytes.equals(result.bytes)).toBe(true)
    expect(em.rows('FormAttachment')).toHaveLength(1)
  })

  it('loads the submission and decrypts the revision once when building the canonical snapshot lazily', async () => {
    const { em, service, submissionId } = buildFixture()
    revealDetails(em)
    const findOne = jest.spyOn(em, 'findOne')
    const decrypt = jest.spyOn(identityEncryption, 'decrypt')

    try {
      const result = await service.readSnapshotForViewer({
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        submissionId,
        viewerRole: 'clinician',
      })

      expect(result.attachmentId).toBe(em.rows('FormSubmission')[0].pdfSnapshotAttachmentId)
      const loadedEntities = findOne.mock.calls.map(([entity]) => entity.name)
      expect(loadedEntities.filter((name) => name === 'FormSubmission')).toHaveLength(1)
      expect(loadedEntities.filter((name) => name === 'FormSubmissionRevision')).toHaveLength(1)
      expect(decrypt).toHaveBeenCalledTimes(1)
    } finally {
      findOne.mockRestore()
      decrypt.mockRestore()
    }
  })

  it('serves the canonical snapshot when the only unreadable property is a layout info_block', async () => {
    const { em, service, submissionId, emitted } = buildFixture({ withInfoBlock: true })
    revealDetails(em)

    const result = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'clinician',
    })

    expect(result.attachmentId).not.toBeNull()
    expect(result.attachmentId).toBe(em.rows('FormSubmission')[0].pdfSnapshotAttachmentId)
    expect(pdfContains(result.bytes, CLINICIAN_NOTE)).toBe(true)

    await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'clinician',
    })
    expect(em.rows('FormAttachment')).toHaveLength(1)
    expect(emitted).toEqual(['forms.attachment.uploaded'])
  })

  it('names the role-filtered copy distinctly from the canonical snapshot', async () => {
    const { service, submissionId } = buildFixture()
    const result = await service.readSnapshotForViewer({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
      viewerRole: 'patient',
    })
    expect(result.filename).toBe(`submission-${submissionId}-v1-participant.pdf`)
  })

  it('keeps the NOT_FOUND / NOT_SUBMITTED checks of ensureSnapshot', async () => {
    const { em, service, submissionId } = buildFixture()
    await expect(
      service.readSnapshotForViewer({
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        submissionId: randomUUID(),
        viewerRole: 'patient',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    em.rows('FormSubmission')[0].status = 'draft'
    await expect(
      service.readSnapshotForViewer({ organizationId: ORG_ID, tenantId: TENANT_ID, submissionId, viewerRole: 'patient' }),
    ).rejects.toMatchObject({ code: 'NOT_SUBMITTED' })
  })

  it('still hands staff the full canonical snapshot through ensureSnapshot', async () => {
    const { service, submissionId } = buildFixture()
    const canonical = await service.ensureSnapshot({ organizationId: ORG_ID, tenantId: TENANT_ID, submissionId })
    expect(pdfContains(canonical.bytes, PATIENT_NAME)).toBe(true)
    expect(pdfContains(canonical.bytes, CLINICIAN_NOTE)).toBe(true)
  })
})

describe('public submission PDF route end-to-end (#7229)', () => {
  it('streams a PDF without the clinician-only answer to a patient token principal', async () => {
    const { em, service, submissionId } = buildFixture()
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'formsPdfSnapshotService') return service
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    })
    resolveRuntimePrincipal.mockResolvedValue({
      source: 'token',
      principal: randomUUID(),
      role: 'patient',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId,
    })

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${submissionId}/pdf`) as never,
      { params: { id: submissionId } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdfContains(bytes, PATIENT_NAME)).toBe(true)
    expect(pdfContains(bytes, CLINICIAN_NOTE)).toBe(false)
  })
})
