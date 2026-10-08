import {
  buildSnapshotDocument,
  renderDocumentToPdf,
  type BuildSnapshotDocumentArgs,
} from '../services/pdf-snapshot-service'
import type { Form, FormSubmission, FormVersion } from '../data/entities'

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const VERSION_ID = '44444444-4444-4444-4444-444444444444'
const SUBMITTED_BY = '55555555-5555-5555-5555-555555555555'
const CLAUSE_SHA = 'a'.repeat(64)

function buildForm(): Form {
  return {
    id: 'form-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key: 'consent',
    name: 'Patient Consent Form',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdBy: SUBMITTED_BY,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Form
}

function buildVersion(): FormVersion {
  return {
    id: VERSION_ID,
    formId: 'form-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    versionNumber: 7,
    status: 'published',
    schemaHash: 'sha256:deadbeef',
    registryVersion: 'v1:abc',
    schema: {
      type: 'object',
      'x-om-roles': ['patient'],
      'x-om-sections': [
        {
          key: 'health',
          title: { en: 'Health History' },
          fieldKeys: ['allergies', 'smoker', 'visit_date'],
        },
        {
          key: 'consent',
          title: { en: 'Consent' },
          fieldKeys: ['agree', 'sig'],
        },
        {
          key: 'note',
          title: { en: 'Notes' },
          fieldKeys: ['intro'],
        },
      ],
      properties: {
        allergies: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: 'Known allergies' } },
        smoker: { type: 'boolean', 'x-om-type': 'boolean', 'x-om-label': { en: 'Do you smoke?' } },
        visit_date: { type: 'string', 'x-om-type': 'date', 'x-om-label': { en: 'Last visit' } },
        agree: { type: 'boolean', 'x-om-type': 'boolean', 'x-om-label': { en: 'I agree' } },
        sig: {
          type: 'object',
          'x-om-type': 'signature',
          'x-om-label': { en: 'Signature' },
          'x-om-consent-clause': { en: 'I consent to the proposed treatment.' },
        },
        intro: { type: 'null', 'x-om-type': 'info_block', 'x-om-label': { en: 'Please read carefully' } },
      },
    },
    uiSchema: {},
    roles: ['patient'],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FormVersion
}

function buildSubmission(): FormSubmission {
  return {
    id: SUBMISSION_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: VERSION_ID,
    subjectType: 'forms_invitation',
    subjectId: '66666666-6666-6666-6666-666666666666',
    status: 'submitted',
    startedBy: SUBMITTED_BY,
    submittedBy: SUBMITTED_BY,
    submittedAt: new Date('2026-05-21T10:30:00.000Z'),
    submitMetadata: {
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (TestRunner)',
      serverSubmittedAt: '2026-05-21T10:30:00.000Z',
    },
    firstSavedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FormSubmission
}

function args(answers: Record<string, unknown>): BuildSnapshotDocumentArgs {
  return {
    form: buildForm(),
    formVersion: buildVersion(),
    submission: buildSubmission(),
    answers,
  }
}

describe('buildSnapshotDocument', () => {
  const answers = {
    allergies: 'Penicillin',
    smoker: false,
    visit_date: '2026-01-15',
    agree: true,
    sig: {
      mode: 'typed',
      typedName: 'Jane Patient',
      affirmed: true,
      signedAt: '2026-05-21T10:29:50.000Z',
      clauseSha256: CLAUSE_SHA,
    },
  }

  it('renders form name + version number', () => {
    const doc = buildSnapshotDocument(args(answers))
    expect(doc.formName).toBe('Patient Consent Form')
    expect(doc.versionNumber).toBe(7)
    expect(doc.locale).toBe('en')
  })

  it('renders labels and human-readable answers in section order', () => {
    const doc = buildSnapshotDocument(args(answers))
    const health = doc.sections.find((section) => section.key === 'health')
    expect(health?.title).toBe('Health History')
    const byKey = Object.fromEntries((health?.fields ?? []).map((field) => [field.key, field]))
    expect(byKey.allergies.label).toBe('Known allergies')
    expect(byKey.allergies.answer).toBe('Penicillin')
    // boolean export adapter → human readable
    expect(byKey.smoker.answer).toBe('No')
    expect(byKey.visit_date.answer).toBe('2026-01-15')
  })

  it('drops layout-only fields (info_block) from the model', () => {
    const doc = buildSnapshotDocument(args(answers))
    const note = doc.sections.find((section) => section.key === 'note')
    expect(note).toBeUndefined()
  })

  it('captures signature evidence: clause text, SHA-256, signedAt, typed name', () => {
    const doc = buildSnapshotDocument(args(answers))
    const consent = doc.sections.find((section) => section.key === 'consent')
    const sigField = consent?.fields.find((field) => field.key === 'sig')
    expect(sigField?.signature).toBeDefined()
    expect(sigField?.signature?.mode).toBe('typed')
    expect(sigField?.signature?.typedName).toBe('Jane Patient')
    expect(sigField?.signature?.clauseText).toBe('I consent to the proposed treatment.')
    expect(sigField?.signature?.clauseSha256).toBe(CLAUSE_SHA)
    expect(sigField?.signature?.signedAt).toBe('2026-05-21T10:29:50.000Z')
    expect(sigField?.signature?.imageDataUrl).toBeNull()
  })

  it('captures a drawn signature image data URL', () => {
    const drawn = {
      ...answers,
      sig: {
        mode: 'drawn',
        image: 'data:image/png;base64,iVBORw0KGgo=',
        affirmed: true,
        signedAt: '2026-05-21T10:29:50.000Z',
        clauseSha256: CLAUSE_SHA,
      },
    }
    const doc = buildSnapshotDocument(args(drawn))
    const sigField = doc.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === 'sig')
    expect(sigField?.signature?.mode).toBe('drawn')
    expect(sigField?.signature?.imageDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('builds the audit block from submission + version metadata (UTC)', () => {
    const doc = buildSnapshotDocument(args(answers))
    expect(doc.audit.submissionId).toBe(SUBMISSION_ID)
    expect(doc.audit.submittedBy).toBe(SUBMITTED_BY)
    expect(doc.audit.submittedAtUtc).toBe('2026-05-21T10:30:00.000Z')
    expect(doc.audit.ip).toBe('203.0.113.7')
    expect(doc.audit.userAgent).toBe('Mozilla/5.0 (TestRunner)')
    expect(doc.audit.formVersionId).toBe(VERSION_ID)
    expect(doc.audit.schemaHash).toBe('sha256:deadbeef')
    expect(doc.audit.organizationId).toBe(ORG_ID)
  })

  it('appends un-sectioned properties so nothing is dropped', () => {
    const version = buildVersion()
    ;(version.schema as Record<string, unknown>)['x-om-sections'] = [
      { key: 'health', title: { en: 'Health History' }, fieldKeys: ['allergies'] },
    ]
    const doc = buildSnapshotDocument({
      form: buildForm(),
      formVersion: version,
      submission: buildSubmission(),
      answers,
    })
    const leftover = doc.sections.find((section) => section.key === '__fields__')
    expect(leftover).toBeDefined()
    const keys = leftover?.fields.map((field) => field.key) ?? []
    expect(keys).toEqual(expect.arrayContaining(['smoker', 'visit_date', 'agree', 'sig']))
  })
})

describe('renderDocumentToPdf', () => {
  it('produces a non-empty PDF buffer with the %PDF header', async () => {
    const doc = buildSnapshotDocument(
      args({
        allergies: 'None',
        smoker: true,
        visit_date: '2026-01-15',
        agree: true,
        sig: {
          mode: 'typed',
          typedName: 'Jane Patient',
          affirmed: true,
          signedAt: '2026-05-21T10:29:50.000Z',
          clauseSha256: CLAUSE_SHA,
        },
      }),
    )
    const bytes = await renderDocumentToPdf(doc)
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(bytes.length).toBeGreaterThan(500)
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders without throwing on non-WinAnsi answer text', async () => {
    const doc = buildSnapshotDocument(
      args({
        allergies: 'penicillin 😀 アレルギー',
        smoker: false,
        agree: true,
      }),
    )
    const bytes = await renderDocumentToPdf(doc)
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
