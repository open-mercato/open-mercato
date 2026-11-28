import { NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { GET as exportSubmission } from '../submissions/[submissionId]/export/route'
import { GET as downloadPdf } from '../submissions/[submissionId]/pdf/route'
import { GET as downloadAttachment } from '../submissions/[submissionId]/attachments/[attachmentId]/route'
import { POST as anonymize } from '../submissions/[submissionId]/anonymize/route'
import { GET as exportSubject } from '../subjects/[subjectType]/[subjectId]/export/route'

const submissionId = 'bc24adf9-c445-4f07-8c4f-079bab6b3950'
const attachmentId = '0b9c1f4e-3a57-4a53-9d0e-6a2f6c0f4b11'
const subjectId = '5d8f0c2a-7a4b-4f1e-9a53-2c1d9e8b7a60'
const userId = '8a1f3c52-1b7e-4c36-8f0d-5e9a2b4c6d71'
const keyId = 'f3e2d1c0-9b8a-4765-8321-0fedcba98765'

const auditLog = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('../../events', () => ({ emitFormsEvent: jest.fn(async () => {}) }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => {
    const services: Record<string, unknown> = {
      formsAccessAuditLogger: { log: auditLog },
      em: { findOne: async () => ({ status: 'submitted' }) },
      formsExportService: {
        exportSubmission: async () => ({ document: {}, submissionIds: [submissionId] }),
        exportSubject: async () => ({ document: {}, submissionIds: [submissionId] }),
      },
      formsPdfSnapshotService: {
        ensureSnapshot: async () => ({ bytes: Buffer.from('pdf'), contentType: 'application/pdf', filename: 'a.pdf' }),
      },
      formsAttachmentService: {
        readUpload: async () => ({ bytes: Buffer.from('file'), contentType: 'text/plain', filename: 'a.txt' }),
      },
      formsAnonymizeService: {
        anonymize: async () => ({ revisionsAnonymized: 1, submissionAnonymizedAt: new Date(0) }),
      },
    }
    return { resolve: (name: string) => services[name] }
  }),
}))

const url = 'https://app.example.test/api/forms'

const routes: Array<[string, () => Promise<Response>]> = [
  ['submission export', () => exportSubmission(new NextRequest(url), { params: { submissionId } })],
  ['PDF download', () => downloadPdf(new NextRequest(url), { params: { submissionId } })],
  ['attachment download', () => downloadAttachment(new NextRequest(url), { params: { submissionId, attachmentId } })],
  [
    'anonymize',
    () => anonymize(
      new NextRequest(url, { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) }),
      { params: { submissionId } },
    ),
  ],
  ['subject export', () => exportSubject(new NextRequest(url), { params: { subjectType: 'customer', subjectId } })],
]

describe.each(routes)('access-audit actor on %s', (_name, call) => {
  beforeEach(() => {
    auditLog.mockClear()
  })

  it.each([
    ['a user session', { sub: userId }, userId],
    ['an API key', { sub: `api_key:${keyId}`, isApiKey: true, keyId, userId }, keyId],
  ])('records a UUID for %s', async (_caller, identity, expected) => {
    jest.mocked(getAuthFromRequest).mockResolvedValue({ tenantId: 'tenant', orgId: 'org', ...identity })

    const response = await call()

    expect(response.status).toBe(200)
    expect(auditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accessedBy: expected }))
  })
})
