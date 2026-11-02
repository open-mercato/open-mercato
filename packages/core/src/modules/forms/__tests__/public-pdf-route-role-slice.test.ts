/** @jest-environment node */

/**
 * #7229 — the public PDF route asks the role-aware `readSnapshotForViewer` with
 * the principal's role and never streams `ensureSnapshot` output itself. The
 * staff route is pinned as a regression guard (still the canonical snapshot).
 */

const createRequestContainer = jest.fn()
const resolveRuntimePrincipal = jest.fn()
const enforcePublicRateLimit = jest.fn<Promise<null>, unknown[]>(async () => null)
const getAuthFromRequest = jest.fn()
const ensureSnapshot = jest.fn()
const readSnapshotForViewer = jest.fn()
const auditLog = jest.fn(async () => undefined)
const emFindOne = jest.fn()
const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...args),
}))

jest.mock('../lib/runtime-principal', () => ({
  resolveRuntimePrincipal: (...args: unknown[]) => resolveRuntimePrincipal(...args),
}))

jest.mock('../api/public/rate-limit', () => ({
  buildPublicRateLimitKey: (namespace: string, ...identifiers: string[]) =>
    `${namespace}:${identifiers.join(':')}`,
  enforcePublicRateLimit: (...args: unknown[]) => enforcePublicRateLimit(...args),
}))

jest.mock('../services/pdf-snapshot-service', () => ({
  PdfSnapshotService: class PdfSnapshotService {},
  PdfSnapshotServiceError: class PdfSnapshotServiceError extends Error {
    code = 'NOT_FOUND'
  },
}))

import { GET as downloadPublicPdf } from '../api/public/submissions/[id]/pdf/route'
import { GET as downloadAdminPdf } from '../api/submissions/[submissionId]/pdf/route'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_ID = '00000000-0000-0000-0000-000000000002'
const SUBMISSION_ID = '00000000-0000-0000-0000-000000000003'

const CANONICAL_BYTES = Buffer.from('%PDF-1.7 canonical CLINICIAN_ONLY_DIAGNOSIS')
const SLICED_BYTES = Buffer.from('%PDF-1.7 participant copy')

function tokenPrincipal(role: string | null) {
  return {
    source: 'token',
    principal: '00000000-0000-0000-0000-000000000004',
    role,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    submissionId: SUBMISSION_ID,
  }
}

async function readBody(response: Response): Promise<string> {
  return Buffer.from(await response.arrayBuffer()).toString('latin1')
}

describe('forms PDF routes — role slicing (#7229)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enforcePublicRateLimit.mockResolvedValue(null)
    ensureSnapshot.mockResolvedValue({
      attachmentId: 'att-canonical',
      filename: 'submission.pdf',
      contentType: 'application/pdf',
      sizeBytes: CANONICAL_BYTES.length,
      bytes: CANONICAL_BYTES,
    })
    readSnapshotForViewer.mockResolvedValue({
      attachmentId: null,
      filename: 'submission.pdf',
      contentType: 'application/pdf',
      sizeBytes: SLICED_BYTES.length,
      bytes: SLICED_BYTES,
    })
    emFindOne.mockResolvedValue({
      id: SUBMISSION_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      status: 'submitted',
    })
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return { findOne: emFindOne }
        if (name === 'formsPdfSnapshotService') return { ensureSnapshot, readSnapshotForViewer }
        if (name === 'formsAccessAuditLogger') return { log: auditLog }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    })
  })

  it('never streams the canonical snapshot to a participant without asking the role-aware path', async () => {
    resolveRuntimePrincipal.mockResolvedValue(tokenPrincipal('patient'))

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { id: SUBMISSION_ID } },
    )

    expect(response.status).toBe(200)
    const body = await readBody(response)
    expect(body).toBe(SLICED_BYTES.toString('latin1'))
    expect(readSnapshotForViewer).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: SUBMISSION_ID,
      viewerRole: 'patient',
    })
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('passes a null role through so the service fails closed instead of defaulting to canonical', async () => {
    resolveRuntimePrincipal.mockResolvedValue(tokenPrincipal(null))

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { id: SUBMISSION_ID } },
    )

    expect(response.status).toBe(200)
    expect(readSnapshotForViewer).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: SUBMISSION_ID, viewerRole: null }),
    )
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('passes a portal customer principal role to the role-aware path', async () => {
    resolveRuntimePrincipal.mockResolvedValue({ ...tokenPrincipal('reviewer'), source: 'customer' })

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { id: SUBMISSION_ID } },
    )

    expect(response.status).toBe(200)
    expect(readSnapshotForViewer).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: SUBMISSION_ID,
      viewerRole: 'reviewer',
    })
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500 INTERNAL_ERROR', async () => {
    resolveRuntimePrincipal.mockResolvedValue(tokenPrincipal('patient'))
    const failure = new Error('[internal] compile failed')
    readSnapshotForViewer.mockRejectedValue(failure)

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { id: SUBMISSION_ID } },
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' })
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'forms',
      code: 'forms.submission_pdf_failed',
    })
  })

  it('keeps the sandbox download headers on the participant PDF', async () => {
    resolveRuntimePrincipal.mockResolvedValue(tokenPrincipal('patient'))

    const response = await downloadPublicPdf(
      new Request(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { id: SUBMISSION_ID } },
    )

    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('keeps serving the full canonical snapshot to staff (admin route unchanged)', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'staff-user', orgId: ORG_ID, tenantId: TENANT_ID })

    const response = await downloadAdminPdf(
      new Request(`http://test/api/forms/submissions/${SUBMISSION_ID}/pdf`) as never,
      { params: { submissionId: SUBMISSION_ID } },
    )

    expect(response.status).toBe(200)
    expect(await readBody(response)).toContain('CLINICIAN_ONLY_DIAGNOSIS')
    expect(ensureSnapshot).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: SUBMISSION_ID,
    })
    expect(readSnapshotForViewer).not.toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalledTimes(1)
  })
})
