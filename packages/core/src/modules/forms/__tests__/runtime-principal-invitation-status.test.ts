/** @jest-environment node */
import { randomUUID } from 'node:crypto'

process.env.FORMS_DISTRIBUTION_TOKEN_SECRET = 'forms-distribution-test-secret'

const getCustomerAuthFromRequest = jest.fn<Promise<unknown>, unknown[]>(async () => null)

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => getCustomerAuthFromRequest(...(args as [])),
}))

import { FormInvitation, FormSubmission, FormSubmissionActor } from '../data/entities'
import { resolveRuntimePrincipal } from '../lib/runtime-principal'
import { DistributionService, DistributionServiceError } from '../services/distribution-service'
import { signAccessToken } from '../services/distribution-token'

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000333'
const TENANT_ID = '00000000-0000-0000-0000-000000000222'
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000444'
const SUBMITTED_AT = new Date('2026-10-13T12:00:00Z')

type Row = Record<string, unknown> & { id: string }

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected === null) return actual === null || actual === undefined
    return actual === expected
  })
}

function createFakeEm(tables: Map<unknown, Row[]>) {
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const rows = tables.get(entity) ?? []
      return rows.find((row) => matches(row, where)) ?? null
    }),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    transactional: jest.fn(async <T>(callback: (trx: unknown) => Promise<T>): Promise<T> => callback(em)),
  }
  return em
}

type Fixture = {
  submissionId: string
  invitationId: string
  invitation: Row
  actor: Row
  tables: Map<unknown, Row[]>
}

function buildFixture(invitationOverrides: Partial<Row> = {}, actorOverrides: Partial<Row> = {}): Fixture {
  const submissionId = randomUUID()
  const invitationId = randomUUID()
  const submission: Row = {
    id: submissionId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    status: 'draft',
    deletedAt: null,
  }
  const invitation: Row = {
    id: invitationId,
    distributionId: randomUUID(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    status: 'started',
    submissionId,
    submittedAt: null,
    deletedAt: null,
    ...invitationOverrides,
  }
  const actor: Row = {
    id: randomUUID(),
    submissionId,
    organizationId: ORG_ID,
    userId: invitationId,
    role: 'participant',
    revokedAt: null,
    deletedAt: null,
    ...actorOverrides,
  }
  const tables = new Map<unknown, Row[]>([
    [FormSubmission, [submission]],
    [FormInvitation, [invitation]],
    [FormSubmissionActor, [actor]],
  ])
  return { submissionId, invitationId, invitation, actor, tables }
}

function bearerRequest(submissionId: string, invitationId: string): Request {
  const token = signAccessToken({
    submissionId,
    invitationId,
    role: 'participant',
    expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
  })
  return new Request(`http://localhost/api/forms/public/submissions/${submissionId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

async function resolveFor(fixture: Fixture) {
  const em = createFakeEm(fixture.tables)
  return resolveRuntimePrincipal({
    req: bearerRequest(fixture.submissionId, fixture.invitationId),
    submissionId: fixture.submissionId,
    em: em as never,
  })
}

describe('resolveRuntimePrincipal — token branch honours the invitation and actor state (#7230)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(['pending', 'sent', 'opened', 'started'])('authorizes a token whose invitation is %s', async (status) => {
    const fixture = buildFixture({ status })
    const principal = await resolveFor(fixture)
    expect(principal).toEqual({
      source: 'token',
      principal: fixture.invitationId,
      role: 'participant',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: fixture.submissionId,
    })
  })

  it('keeps access for a submitted invitation so the completion screen can download its copy', async () => {
    const fixture = buildFixture({ status: 'submitted', submittedAt: SUBMITTED_AT })
    const principal = await resolveFor(fixture)
    expect(principal?.principal).toBe(fixture.invitationId)
  })

  it.each(['revoked', 'expired'])('rejects a token whose invitation is %s', async (status) => {
    const fixture = buildFixture({ status })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose invitation was deleted', async () => {
    const fixture = buildFixture({ deletedAt: new Date() })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose invitation belongs to another organization than the submission', async () => {
    const fixture = buildFixture({ organizationId: OTHER_ORG_ID })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose invitation belongs to another tenant than the submission', async () => {
    const fixture = buildFixture({ tenantId: OTHER_TENANT_ID })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose invitation is bound to another submission', async () => {
    const fixture = buildFixture({ submissionId: randomUUID() })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose actor row was revoked by staff', async () => {
    const fixture = buildFixture({}, { revokedAt: new Date() })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('rejects a token whose actor row was deleted', async () => {
    const fixture = buildFixture({}, { deletedAt: new Date() })
    await expect(resolveFor(fixture)).resolves.toBeNull()
  })

  it('takes the role from the current actor row, not from the token', async () => {
    const fixture = buildFixture({}, { role: 'reviewer' })
    const principal = await resolveFor(fixture)
    expect(principal?.role).toBe('reviewer')
  })

  it('restores access when a revoke is undone', async () => {
    const fixture = buildFixture({ status: 'revoked' })
    await expect(resolveFor(fixture)).resolves.toBeNull()
    fixture.invitation.status = 'started'
    await expect(resolveFor(fixture)).resolves.toMatchObject({ principal: fixture.invitationId })
  })

  it('does not fall through to the customer session when the invitation is revoked', async () => {
    const fixture = buildFixture({ status: 'revoked' })
    await resolveFor(fixture)
    expect(getCustomerAuthFromRequest).not.toHaveBeenCalled()
  })
})

describe('resolveRuntimePrincipal — customer session branch is unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('authorizes a portal customer through their active actor row when no bearer token is sent', async () => {
    const fixture = buildFixture()
    const customerId = randomUUID()
    ;(fixture.tables.get(FormSubmissionActor) as Row[]).push({
      id: randomUUID(),
      submissionId: fixture.submissionId,
      organizationId: ORG_ID,
      userId: customerId,
      role: 'customer',
      revokedAt: null,
      deletedAt: null,
    })
    getCustomerAuthFromRequest.mockResolvedValueOnce({ sub: customerId, orgId: ORG_ID, tenantId: TENANT_ID })
    const em = createFakeEm(fixture.tables)

    const principal = await resolveRuntimePrincipal({
      req: new Request(`http://localhost/api/forms/public/submissions/${fixture.submissionId}`),
      submissionId: fixture.submissionId,
      em: em as never,
    })

    expect(principal).toEqual({
      source: 'customer',
      principal: customerId,
      role: 'customer',
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: fixture.submissionId,
    })
  })
})

describe('DistributionService.markInvitationSubmitted — never resurrects a closed invitation (#7230)', () => {
  function buildService(fixture: Fixture) {
    const em = createFakeEm(fixture.tables)
    const emitEvent = jest.fn(async () => undefined)
    const warn = jest.fn()
    const service = new DistributionService({
      emFactory: () => em as never,
      submissionService: {} as never,
      emitEvent,
      now: () => SUBMITTED_AT,
      logger: { info: jest.fn(), warn, error: jest.fn() },
    })
    return { service, em, emitEvent, warn }
  }

  function markArgs(fixture: Fixture) {
    return {
      invitationId: fixture.invitationId,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: fixture.submissionId,
    }
  }

  it.each(['revoked', 'expired'])('leaves an invitation in status %s unchanged and emits nothing', async (status) => {
    const fixture = buildFixture({ status })
    const { service, emitEvent, warn } = buildService(fixture)

    await expect(service.markInvitationSubmitted(markArgs(fixture))).resolves.toBeUndefined()

    expect(fixture.invitation.status).toBe(status)
    expect(fixture.invitation.submittedAt).toBeNull()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'forms.distribution.invitation_submit_skipped', status }),
      expect.any(String),
    )
  })

  it('re-stamps an already submitted invitation so a reopened submission can be resubmitted', async () => {
    const earlier = new Date('2026-10-12T08:00:00Z')
    const fixture = buildFixture({ status: 'submitted', submittedAt: earlier })
    const { service, emitEvent } = buildService(fixture)

    await service.markInvitationSubmitted(markArgs(fixture))

    expect(fixture.invitation.status).toBe('submitted')
    expect(fixture.invitation.submittedAt).toEqual(SUBMITTED_AT)
    expect(emitEvent).toHaveBeenCalledWith('forms.invitation.submitted', {
      invitationId: fixture.invitationId,
      submissionId: fixture.submissionId,
    })
  })

  it('marks an in-progress invitation submitted under a row lock and emits the event', async () => {
    const fixture = buildFixture({ status: 'started' })
    const { service, em, emitEvent } = buildService(fixture)

    await service.markInvitationSubmitted(markArgs(fixture))

    expect(fixture.invitation.status).toBe('submitted')
    expect(fixture.invitation.submittedAt).toEqual(SUBMITTED_AT)
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(
      FormInvitation,
      expect.objectContaining({ id: fixture.invitationId }),
      expect.objectContaining({ lockMode: expect.anything() }),
    )
    expect(emitEvent).toHaveBeenCalledWith('forms.invitation.submitted', {
      invitationId: fixture.invitationId,
      submissionId: fixture.submissionId,
    })
  })

  it('still answers 404 when the invitation does not exist', async () => {
    const fixture = buildFixture({ deletedAt: new Date() })
    const { service } = buildService(fixture)

    await expect(service.markInvitationSubmitted(markArgs(fixture))).rejects.toMatchObject({
      constructor: DistributionServiceError,
      code: 'NOT_FOUND',
      httpStatus: 404,
    })
  })
})
