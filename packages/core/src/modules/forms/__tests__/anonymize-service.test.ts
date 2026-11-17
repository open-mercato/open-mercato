import {
  ANONYMIZED_FIELD_TOKEN,
  AnonymizeService,
  AnonymizeServiceError,
} from '../services/anonymize-service'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { defaultFieldTypeRegistry } from '../schema/field-type-registry'
import { FormsEncryptionService, DevDeterministicKmsAdapter } from '../services/encryption-service'
import {
  FormAttachment,
  FormInvitation,
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
  FormsEncryptionKey,
} from '../data/entities'

class StubEntityManager {
  rows: Map<unknown, unknown[]> = new Map()
  flushed = false

  async findOne<T>(EntityClass: new () => T, where: Partial<T>): Promise<T | null> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    const match = list.find((row) => {
      return Object.entries(where).every(([key, value]) => {
        return (row as Record<string, unknown>)[key] === value
      })
    })
    return match ?? null
  }

  async find<T>(
    EntityClass: new () => T,
    where: Partial<T>,
    options?: { orderBy?: Record<string, 'asc' | 'desc'> },
  ): Promise<T[]> {
    const list = (this.rows.get(EntityClass) ?? []) as T[]
    let filtered = list.filter((row) => {
      return Object.entries(where).every(([key, value]) => {
        return (row as Record<string, unknown>)[key] === value
      })
    })
    if (options?.orderBy) {
      const [[field, direction]] = Object.entries(options.orderBy)
      filtered = [...filtered].sort((a, b) => {
        const av = Number((a as Record<string, unknown>)[field])
        const bv = Number((b as Record<string, unknown>)[field])
        return direction === 'asc' ? av - bv : bv - av
      })
    }
    return filtered
  }

  create<T>(EntityClass: new () => T, data: Partial<T>): T {
    const instance = Object.assign(new EntityClass(), data)
    return instance
  }

  persist(_entity: unknown): void {
    /* not used */
  }

  async flush(): Promise<void> {
    this.flushed = true
  }
}

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const SUBMISSION_ID = '00000000-0000-0000-0000-000000000010'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const FORM_VERSION_ID = '00000000-0000-0000-0000-000000000011'

function buildCompiledForm() {
  return {
    id: FORM_VERSION_ID,
    updatedAt: new Date('2026-05-08T10:00:00Z'),
    schema: {
      type: 'object',
      'x-om-roles': ['patient'],
      'x-om-default-actor-role': 'patient',
      properties: {
        ssn: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-sensitive': true,
          'x-om-editable-by': ['patient'],
        },
        nickname: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-editable-by': ['patient'],
        },
      },
    },
    uiSchema: {},
  }
}

async function buildHarness() {
  const em = new StubEntityManager()
  const encryption = new FormsEncryptionService({
    emFactory: () => em as never,
    kmsAdapter: new DevDeterministicKmsAdapter('test-kms-key'),
  })
  const compiler = new FormVersionCompiler({ registry: defaultFieldTypeRegistry })

  const formVersion = em.create(FormVersion, {
    id: FORM_VERSION_ID,
    formId: '00000000-0000-0000-0000-000000000020',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    versionNumber: 1,
    status: 'published',
    schema: buildCompiledForm().schema,
    uiSchema: {},
    roles: ['patient'],
    schemaHash: 'test-hash',
    registryVersion: defaultFieldTypeRegistry.getRegistryVersion(),
    updatedAt: new Date('2026-05-08T10:00:00Z'),
  })
  em.rows.set(FormVersion, [formVersion])

  const submission = em.create(FormSubmission, {
    id: SUBMISSION_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: FORM_VERSION_ID,
    subjectType: 'customer',
    subjectId: '00000000-0000-0000-0000-000000000030',
    status: 'submitted',
    currentRevisionId: null,
    startedBy: 'starter',
    submitMetadata: { ip: '1.2.3.4', ua: 'Mozilla/5.0' },
    pdfSnapshotAttachmentId: 'snapshot-1',
    anonymizedAt: null,
  })
  em.rows.set(FormSubmission, [submission])

  // Seed two revisions with sensitive + non-sensitive fields.
  const ciphertext1 = await encryption.encrypt(
    ORG_ID,
    Buffer.from(JSON.stringify({ ssn: '123-45-6789', nickname: 'Lou' }), 'utf-8'),
  )
  const ciphertext2 = await encryption.encrypt(
    ORG_ID,
    Buffer.from(JSON.stringify({ ssn: '987-65-4321', nickname: 'Lou' }), 'utf-8'),
  )

  const rev1 = em.create(FormSubmissionRevision, {
    id: 'rev-1',
    submissionId: SUBMISSION_ID,
    organizationId: ORG_ID,
    revisionNumber: 1,
    data: ciphertext1,
    encryptionKeyVersion: 1,
    savedBy: 'starter',
    savedByRole: 'patient',
    changeSource: 'user',
    changedFieldKeys: ['ssn', 'nickname'],
  })
  const rev2 = em.create(FormSubmissionRevision, {
    id: 'rev-2',
    submissionId: SUBMISSION_ID,
    organizationId: ORG_ID,
    revisionNumber: 2,
    data: ciphertext2,
    encryptionKeyVersion: 1,
    savedBy: 'starter',
    savedByRole: 'patient',
    changeSource: 'user',
    changedFieldKeys: ['ssn'],
  })
  em.rows.set(FormSubmissionRevision, [rev1, rev2])

  const attachments = [
    em.create(FormAttachment, {
      id: 'upload-1',
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      fieldKey: 'document',
      kind: 'user_upload',
      fileId: '00000000-0000-0000-0000-000000000040',
      payloadInline: Buffer.from('encrypted-upload'),
      contentType: 'application/pdf',
      filename: 'identity-document.pdf',
      sizeBytes: 256,
      uploadedBy: '00000000-0000-0000-0000-000000000030',
    }),
    em.create(FormAttachment, {
      id: 'snapshot-1',
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      fieldKey: '__snapshot__',
      kind: 'snapshot',
      payloadInline: Buffer.from('encrypted-pdf'),
      contentType: 'application/pdf',
      filename: 'submission.pdf',
      sizeBytes: 512,
    }),
  ]
  em.rows.set(FormAttachment, attachments)

  const invitation = em.create(FormInvitation, {
    id: '00000000-0000-0000-0000-000000000050',
    distributionId: '00000000-0000-0000-0000-000000000051',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    recipientEmail: 'person@example.com',
    recipientName: 'Example Person',
    recipientRef: 'crm-contact-123',
    submissionId: SUBMISSION_ID,
  })
  em.rows.set(FormInvitation, [invitation])

  // Stub the EncryptionKey row so the service can find a wrapped DEK if it queries.
  em.rows.set(FormsEncryptionKey, [])

  return { em, encryption, compiler, submission, revisions: [rev1, rev2], attachments, invitation }
}

describe('AnonymizeService', () => {
  it('replaces sensitive fields with the tombstone token across all revisions', async () => {
    const harness = await buildHarness()
    const service = new AnonymizeService({
      em: harness.em as never,
      compiler: harness.compiler,
      encryption: harness.encryption,
    })
    const result = await service.anonymize(SUBMISSION_ID, SCOPE)
    expect(result.revisionsAnonymized).toBe(2)
    for (const rev of harness.revisions) {
      const decoded = JSON.parse((await harness.encryption.decrypt(ORG_ID, rev.data)).toString('utf-8'))
      expect(decoded.ssn).toBe(ANONYMIZED_FIELD_TOKEN)
      expect(decoded.nickname).toBe('Lou')
      expect(rev.anonymizedAt).toBeInstanceOf(Date)
    }
    expect(harness.submission.anonymizedAt).toBeInstanceOf(Date)
    expect(harness.submission.submitMetadata).toEqual({
      anonymized_at: expect.any(String),
    })
    expect(harness.submission.pdfSnapshotAttachmentId).toBeNull()
    for (const attachment of harness.attachments) {
      expect(attachment.removedAt).toBeInstanceOf(Date)
      expect(attachment.payloadInline).toBeNull()
      expect(attachment.fileId).toBeNull()
      expect(attachment.filename).toBeNull()
      expect(attachment.uploadedBy).toBeNull()
    }
    expect(harness.invitation.recipientEmail).toBeNull()
    expect(harness.invitation.recipientName).toBeNull()
    expect(harness.invitation.recipientRef).toBeNull()
  })

  it('is idempotent — re-running a second time skips already-anonymized revisions', async () => {
    const harness = await buildHarness()
    const service = new AnonymizeService({
      em: harness.em as never,
      compiler: harness.compiler,
      encryption: harness.encryption,
    })
    const first = await service.anonymize(SUBMISSION_ID, SCOPE)
    expect(first.revisionsAnonymized).toBe(2)
    const second = await service.anonymize(SUBMISSION_ID, SCOPE)
    expect(second.revisionsAnonymized).toBe(0)
    expect(second.submissionAnonymizedAt).toEqual(harness.submission.anonymizedAt)
  })

  it('finishes artifact erasure for a previously anonymized submission', async () => {
    const harness = await buildHarness()
    const priorAnonymizedAt = new Date('2026-05-09T10:00:00Z')
    harness.submission.anonymizedAt = priorAnonymizedAt
    for (const revision of harness.revisions) revision.anonymizedAt = priorAnonymizedAt
    const service = new AnonymizeService({
      em: harness.em as never,
      compiler: harness.compiler,
      encryption: harness.encryption,
    })

    const result = await service.anonymize(SUBMISSION_ID, SCOPE)

    expect(result).toEqual({ revisionsAnonymized: 0, submissionAnonymizedAt: priorAnonymizedAt })
    expect(harness.submission.pdfSnapshotAttachmentId).toBeNull()
    expect(harness.attachments.every((attachment) => attachment.payloadInline === null)).toBe(true)
    expect(harness.invitation.recipientEmail).toBeNull()
  })

  it('raises SUBMISSION_NOT_FOUND when the submission does not exist', async () => {
    const harness = await buildHarness()
    const service = new AnonymizeService({
      em: harness.em as never,
      compiler: harness.compiler,
      encryption: harness.encryption,
    })
    await expect(service.anonymize('does-not-exist', SCOPE)).rejects.toBeInstanceOf(AnonymizeServiceError)
  })

  it('refuses a submission outside the caller scope and leaves it intact', async () => {
    const harness = await buildHarness()
    const service = new AnonymizeService({
      em: harness.em as never,
      compiler: harness.compiler,
      encryption: harness.encryption,
    })

    // Anonymize is irreversible, and the route used to validate the caller's
    // tenant/org and then drop them — so any holder of forms.submissions
    // .anonymize could tombstone another tenant's submission by UUID.
    const otherTenant = { tenantId: '00000000-0000-0000-0000-0000000000ff', organizationId: ORG_ID }
    await expect(service.anonymize(SUBMISSION_ID, otherTenant)).rejects.toBeInstanceOf(AnonymizeServiceError)

    const otherOrg = { tenantId: TENANT_ID, organizationId: '00000000-0000-0000-0000-0000000000fe' }
    await expect(service.anonymize(SUBMISSION_ID, otherOrg)).rejects.toBeInstanceOf(AnonymizeServiceError)

    expect(harness.submission.anonymizedAt).toBeFalsy()
    for (const rev of harness.revisions) {
      expect(rev.anonymizedAt).toBeFalsy()
      const decoded = JSON.parse((await harness.encryption.decrypt(ORG_ID, rev.data)).toString('utf-8'))
      expect(decoded.ssn).not.toBe(ANONYMIZED_FIELD_TOKEN)
    }
  })
})
