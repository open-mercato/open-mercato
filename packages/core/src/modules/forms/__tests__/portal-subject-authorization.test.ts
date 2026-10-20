/** @jest-environment node */

const createRequestContainer = jest.fn()
const getCustomerAuthFromRequest = jest.fn()
const resolveRuntimePrincipal = jest.fn()
const enforcePublicRateLimit = jest.fn(async () => null)

const start = jest.fn()
const submit = jest.fn()
const getActiveFormVersionByKey = jest.fn()
const findOne = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => getCustomerAuthFromRequest(...args),
}))

jest.mock('../lib/runtime-principal', () => ({
  resolveRuntimePrincipal: (...args: unknown[]) => resolveRuntimePrincipal(...args),
}))

jest.mock('../api/public/rate-limit', () => ({
  buildPublicRateLimitKey: (namespace: string, ...identifiers: string[]) =>
    `${namespace}:${identifiers.join(':')}`,
  enforcePublicRateLimit: (...args: unknown[]) => enforcePublicRateLimit(...args),
  getPublicClientIp: () => undefined,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { POST as startSubmission } from '../api/form-submissions/route'
import { POST as portalSubmit } from '../api/form-submissions/[id]/submit/route'
import { POST as publicSubmit } from '../api/public/submissions/[id]/submit/route'
import { FormDistribution, FormInvitation, FormSubmission } from '../data/entities'
import { SubmissionServiceError } from '../services/submission-service'
import { isPortalSubmitAllowed } from '../lib/portal-subject-policy'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const TENANT_ID = '00000000-0000-4000-8000-000000000002'
const CALLER_ID = '0000000a-0000-4000-8000-00000000000a'
const VICTIM_ID = '0000000b-0000-4000-8000-00000000000b'
const STAFF_STARTER_ID = '0000000c-0000-4000-8000-00000000000c'
const CALLER_PERSON_ID = '0000000d-0000-4000-8000-00000000000d'
const CALLER_COMPANY_ID = '0000000f-0000-4000-8000-00000000000f'
const SUBMISSION_ID = '00000000-0000-4000-8000-0000000000aa'
const REVISION_ID = '00000000-0000-4000-8000-0000000000bb'
const INVITATION_ID = '00000000-0000-4000-8000-0000000000ee'
const DISTRIBUTION_ID = '00000000-0000-4000-8000-0000000000ff'

const customerAuth = {
  sub: CALLER_ID,
  sid: '00000000-0000-4000-8000-0000000000cc',
  type: 'customer' as const,
  tenantId: TENANT_ID,
  orgId: ORG_ID,
  email: 'caller@test.local',
  displayName: 'Caller',
  customerEntityId: CALLER_COMPANY_ID,
  personEntityId: CALLER_PERSON_ID,
  resolvedFeatures: [],
}

const customerPrincipal = {
  source: 'customer' as const,
  principal: CALLER_ID,
  role: 'participant',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  submissionId: SUBMISSION_ID,
}

function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUBMISSION_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: '00000000-0000-4000-8000-0000000000dd',
    subjectType: 'customer',
    subjectId: CALLER_ID,
    status: 'draft',
    currentRevisionId: REVISION_ID,
    startedBy: CALLER_ID,
    submittedBy: null,
    deletedAt: null,
    ...overrides,
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function startRequest(subjectType: string, subjectId: string): Request {
  return jsonRequest('http://test/api/forms/form-submissions', {
    form_key: 'consent_form',
    subject_type: subjectType,
    subject_id: subjectId,
  })
}

function callPortalSubmit() {
  return portalSubmit(
    jsonRequest(`http://test/api/forms/form-submissions/${SUBMISSION_ID}/submit`, {
      base_revision_id: REVISION_ID,
    }) as never,
    { params: { id: SUBMISSION_ID } },
  )
}

function callPublicSubmit() {
  return publicSubmit(
    jsonRequest(`http://test/api/forms/public/submissions/${SUBMISSION_ID}/submit`, {
      base_revision_id: REVISION_ID,
    }) as never,
    { params: { id: SUBMISSION_ID } },
  )
}

let storedSubmission: Record<string, unknown> | null

beforeEach(() => {
  jest.clearAllMocks()
  storedSubmission = submissionRow()
  enforcePublicRateLimit.mockResolvedValue(null)
  getCustomerAuthFromRequest.mockResolvedValue(customerAuth)
  resolveRuntimePrincipal.mockResolvedValue(customerPrincipal)
  getActiveFormVersionByKey.mockRejectedValue(new Error('[internal] prefill skipped in unit test'))
  start.mockImplementation(async (args: { subjectType: string; subjectId: string; startedBy: string }) => ({
    submission: submissionRow({ subjectType: args.subjectType, subjectId: args.subjectId, startedBy: args.startedBy }),
    revision: { id: REVISION_ID, submissionId: SUBMISSION_ID, revisionNumber: 1 },
    decodedData: {},
    actors: [{ id: 'actor-1', submissionId: SUBMISSION_ID, userId: args.startedBy, role: 'participant' }],
  }))
  submit.mockImplementation(async (args: { submittedBy: string; submittedByPortalCustomer?: boolean }) => {
    const row = storedSubmission as { startedBy: string; subjectType: string; subjectId: string } | null
    if (row && args.submittedByPortalCustomer && !isPortalSubmitAllowed(args.submittedBy, row)) {
      throw new SubmissionServiceError('SUBJECT_FORBIDDEN', 'Submission subject is not the caller\'s own customer subject.', 403)
    }
    return submissionRow({ status: 'submitted', submittedBy: args.submittedBy })
  })
  findOne.mockImplementation(async (entity: unknown) => {
    if (entity === FormSubmission) return storedSubmission
    if (entity === FormInvitation) return { id: INVITATION_ID, distributionId: DISTRIBUTION_ID }
    if (entity === FormDistribution) return { id: DISTRIBUTION_ID, redirectUrl: null }
    return null
  })
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'formsSubmissionService') return { start, submit, getActiveFormVersionByKey }
      if (name === 'formsPrefillResolver') return { resolve: jest.fn(async () => ({})) }
      if (name === 'em') return { findOne, find: jest.fn(async () => []) }
      if (name === 'formsDistributionService') {
        return { reserveResponseSlot: jest.fn(), markInvitationSubmitted: jest.fn() }
      }
      throw new Error(`[internal] unexpected dependency ${name}`)
    },
  })
})

describe('POST /api/forms/form-submissions — subject authorization (#7224)', () => {
  it.each([
    ['another customer', 'customer', VICTIM_ID],
    ['the caller id under another subject type', 'patient', CALLER_ID],
    ['the caller linked person', 'person', CALLER_PERSON_ID],
    ['the caller company', 'company', CALLER_COMPANY_ID],
  ])('rejects a start for %s before persisting anything', async (_label, subjectType, subjectId) => {
    const response = await startSubmission(startRequest(subjectType, subjectId) as never)

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toMatchObject({ error: 'SUBJECT_FORBIDDEN' })
    expect(typeof body.message).toBe('string')
    expect(start).not.toHaveBeenCalled()
    expect(getActiveFormVersionByKey).not.toHaveBeenCalled()
  })

  it.each([
    ['own customer id', 'customer', CALLER_ID],
    ['own customer id in uppercase', 'customer', CALLER_ID.toUpperCase()],
  ])('starts a submission for the caller\'s %s', async (_label, subjectType, subjectId) => {
    const response = await startSubmission(startRequest(subjectType, subjectId) as never)

    expect(response.status).toBe(201)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toMatchObject({
      subjectType,
      subjectId,
      startedBy: CALLER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
  })
})

describe('POST /api/forms/form-submissions/:id/submit — self-started drafts (#7224)', () => {
  it('asks the service to enforce the portal subject policy for the caller', async () => {
    const response = await callPortalSubmit()

    expect(response.status).toBe(200)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submittedBy: CALLER_ID,
      submittedByPortalCustomer: true,
    })
  })

  it('answers a translated 403 when the service refuses a self-started foreign-subject draft', async () => {
    storedSubmission = submissionRow({ subjectId: VICTIM_ID })

    const response = await callPortalSubmit()

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toMatchObject({
      error: 'SUBJECT_FORBIDDEN',
      message: 'You can only start or submit this form for yourself.',
    })
  })

  it('refuses to finalize a self-started draft on an unsupported subject type', async () => {
    storedSubmission = submissionRow({ subjectType: 'patient', subjectId: CALLER_ID })

    const response = await callPortalSubmit()

    expect(response.status).toBe(403)
  })

  it('still lets a staff-assigned co-actor submit on a subject that is not theirs', async () => {
    storedSubmission = submissionRow({ subjectId: VICTIM_ID, startedBy: STAFF_STARTER_ID })

    const response = await callPortalSubmit()

    expect(response.status).toBe(200)
  })

  it('no longer reads the submission in the route before submitting', async () => {
    await callPortalSubmit()

    expect(findOne).not.toHaveBeenCalledWith(FormSubmission, expect.anything())
  })
})

describe('POST /api/forms/public/submissions/:id/submit — customer principal (#7224)', () => {
  it('asks the service to enforce the portal subject policy for a customer session', async () => {
    const response = await callPublicSubmit()

    expect(response.status).toBe(200)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({
      submissionId: SUBMISSION_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submittedBy: CALLER_ID,
      submittedByPortalCustomer: true,
    })
    expect(findOne).not.toHaveBeenCalledWith(FormSubmission, expect.anything())
  })

  it('refuses a customer-session submit of a self-started foreign-subject draft', async () => {
    storedSubmission = submissionRow({ subjectId: VICTIM_ID })

    const response = await callPublicSubmit()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'SUBJECT_FORBIDDEN',
      message: 'You can only start or submit this form for yourself.',
    })
  })

  it('refuses a customer-session submit of a self-started draft on another subject type', async () => {
    storedSubmission = submissionRow({ subjectType: 'person', subjectId: CALLER_PERSON_ID })

    const response = await callPublicSubmit()

    expect(response.status).toBe(403)
  })

  it('still lets a staff-assigned co-actor submit through the public route', async () => {
    storedSubmission = submissionRow({ subjectId: VICTIM_ID, startedBy: STAFF_STARTER_ID })

    const response = await callPublicSubmit()

    expect(response.status).toBe(200)
  })

  it('leaves token (invitation) principals untouched', async () => {
    resolveRuntimePrincipal.mockResolvedValue({
      source: 'token',
      principal: INVITATION_ID,
      role: 'participant',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: SUBMISSION_ID,
    })
    storedSubmission = submissionRow({ subjectType: 'forms_invitation', subjectId: INVITATION_ID, startedBy: INVITATION_ID })

    const response = await callPublicSubmit()

    expect(response.status).toBe(200)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toMatchObject({ submittedBy: INVITATION_ID, submittedByPortalCustomer: false })
  })
})
