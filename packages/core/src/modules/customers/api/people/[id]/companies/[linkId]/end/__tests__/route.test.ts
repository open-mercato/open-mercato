import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { POST, metadata } from '../route'

const mockLoadPersonContext = jest.fn()
const mockReportTelemetryError = jest.fn()

jest.mock('../../../context', () => ({
  loadPersonContext: (...args: unknown[]) => mockLoadPersonContext(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), child: () => logger }
  return { createLogger: () => logger }
})
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  reportTelemetryError: (...args: unknown[]) => mockReportTelemetryError(...args),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const personId = '33333333-3333-4333-8333-333333333333'
const companyId = '44444444-4444-4444-8444-444444444444'
const linkId = '55555555-5555-4555-8555-555555555555'
const userId = '66666666-6666-4666-8666-666666666666'
const otherScopeId = '77777777-7777-4777-8777-777777777777'
const endedOn = '2020-02-29'
const expectedVersion = '2026-11-20T00:00:00.000Z'
const commandId = 'customers.personCompanyLinks.endEmployment'
const params = { id: personId, linkId: companyId }

const execute = jest.fn()
const getGrantedFeatures = jest.fn()
const validateMutation = jest.fn()
const afterMutationSuccess = jest.fn()
const services = {
  commandBus: { execute },
  rbacService: { getGrantedFeatures },
  crudMutationGuardService: { validateMutation, afterMutationSuccess },
}
const container = {
  hasRegistration: (name: string) => Object.prototype.hasOwnProperty.call(services, name),
  resolve: (name: keyof typeof services) => services[name],
}
const context = {
  container,
  auth: { sub: userId, tenantId, orgId: organizationId },
  person: { id: personId, organizationId },
  selectedOrganizationId: organizationId,
}

function makeRequest(body: Record<string, unknown> = { endedOn }) {
  return new Request(`http://localhost/api/customers/people/${personId}/companies/${companyId}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockLoadPersonContext.mockResolvedValue(context)
  getGrantedFeatures.mockResolvedValue(['customers.*'])
  validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { legacy: true } })
  execute.mockResolvedValue({ result: { linkId } })
})

afterEach(() => registerMutationGuards([]))

it('requires authenticated people management access', () => {
  expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['customers.people.manage'] })
})

it('passes the scoped version to the command and applies only the guarded departure date', async () => {
  const guardValidate = jest.fn().mockResolvedValue({
    ok: true,
    modifiedPayload: {
      endedOn: '2020-03-01',
      timezone: 'Mars/Olympus',
      tenantId: otherScopeId,
      organizationId: otherScopeId,
      personEntityId: otherScopeId,
      companyEntityId: otherScopeId,
    },
    shouldRunAfterSuccess: true,
    metadata: { registered: true },
  })
  const guardAfterSuccess = jest.fn()
  const verifyGuardInput = jest.fn().mockResolvedValue({ ok: true })
  registerMutationGuards([{
    moduleId: 'customers',
    guards: [
      {
        id: 'test-employment-guard',
        targetEntity: 'customers.person',
        operations: ['update'],
        features: ['customers.people.manage'],
        validate: guardValidate,
        afterSuccess: guardAfterSuccess,
      },
      {
        id: 'test-employment-target-guard',
        targetEntity: 'customers.person',
        operations: ['update'],
        priority: 60,
        validate: verifyGuardInput,
      },
    ],
  }])
  execute.mockResolvedValue({
    result: { linkId },
    logEntry: { id: 'action-id', undoToken: 'undo-token', commandId, createdAt: expectedVersion },
  })
  const req = makeRequest({ endedOn, companyEntityId: otherScopeId, organizationId: otherScopeId })

  const response = await POST(req, { params })

  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(getGrantedFeatures).toHaveBeenCalledWith(userId, { tenantId, organizationId })
  expect(guardValidate).toHaveBeenCalledWith(expect.objectContaining({
    tenantId,
    organizationId,
    userId,
    resourceId: personId,
    operation: 'update',
    mutationPayload: { endedOn, companyEntityId: companyId },
  }))
  expect(validateMutation).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'customers.person' }))
  expect(validateMutation.mock.calls[0][0].requestHeaders.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBeNull()
  expect(verifyGuardInput).toHaveBeenCalledWith(expect.objectContaining({
    mutationPayload: { endedOn: '2020-03-01', companyEntityId: companyId },
  }))
  expect(execute).toHaveBeenCalledWith(commandId, {
    input: { endedOn: '2020-03-01', tenantId, organizationId, personEntityId: personId, companyEntityId: companyId },
    ctx: expect.objectContaining({ request: req, selectedOrganizationId: organizationId }),
  })
  expect(req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(expectedVersion)
  expect(afterMutationSuccess).toHaveBeenCalledWith(expect.objectContaining({ metadata: { legacy: true } }))
  expect(guardAfterSuccess).toHaveBeenCalledWith(expect.objectContaining({ metadata: { registered: true } }))
  expect(guardAfterSuccess.mock.invocationCallOrder[0]).toBeGreaterThan(execute.mock.invocationCallOrder[0])
  expect(deserializeOperationMetadata(response.headers.get('x-om-operation'))).toMatchObject({
    commandId,
    resourceId: linkId,
    executedAt: expectedVersion,
  })
})

it.each(['0000-01-01', '9999-12-31', '2021-02-29', '2020-02-29T00:00:00Z'])('rejects an invalid date %s before running guards', async (date) => {
  const response = await POST(makeRequest({ endedOn: date }), { params })

  expect(response.status).toBe(400)
  expect(mockLoadPersonContext).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

describe('departure date time zone', () => {
  afterEach(() => jest.useRealTimers())

  it.each([
    { now: '2026-11-24T23:30:00Z', timezone: 'Europe/Warsaw', date: '2026-11-25', status: 200 },
    { now: '2026-11-25T00:30:00Z', timezone: 'America/New_York', date: '2026-11-25', status: 400 },
    { now: '2026-11-24T23:30:00Z', timezone: undefined, date: '2026-11-25', status: 400 },
    { now: '2026-11-25T00:30:00Z', timezone: 'Mars/Olympus', date: '2026-11-25', status: 400 },
  ])('validates $date in $timezone at $now', async ({ now, timezone, date, status }) => {
    jest.useFakeTimers({ now: new Date(now) })

    const response = await POST(makeRequest({ endedOn: date, timezone }), { params })

    expect(response.status).toBe(status)
    if (status === 200) {
      expect(execute).toHaveBeenCalledWith(commandId, expect.objectContaining({
        input: expect.objectContaining({ endedOn: date, timezone }),
      }))
    } else {
      expect(execute).not.toHaveBeenCalled()
    }
  })
})

it('returns 404 when the person does not belong to the selected organization', async () => {
  mockLoadPersonContext.mockResolvedValue({ ...context, selectedOrganizationId: otherScopeId })

  const response = await POST(makeRequest(), { params })

  expect(response.status).toBe(404)
  expect(validateMutation).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('returns the guard rejection without performing the mutation', async () => {
  validateMutation.mockResolvedValue({ ok: false, status: 422, body: { error: 'Blocked' } })

  const response = await POST(makeRequest(), { params })

  expect(response.status).toBe(422)
  await expect(response.json()).resolves.toEqual({ error: 'Blocked' })
  expect(execute).not.toHaveBeenCalled()
  expect(afterMutationSuccess).not.toHaveBeenCalled()
})

it('preserves an optimistic lock conflict without running post-mutation callbacks', async () => {
  const conflict = {
    code: 'optimistic_lock_conflict',
    error: 'record_modified',
    expectedUpdatedAt: expectedVersion,
    currentUpdatedAt: '2026-11-21T00:00:00.000Z',
  }
  execute.mockRejectedValue(new CrudHttpError(409, conflict))

  const response = await POST(makeRequest(), { params })

  expect(response.status).toBe(409)
  await expect(response.json()).resolves.toEqual(conflict)
  expect(afterMutationSuccess).not.toHaveBeenCalled()
})

it('reports a callback failure and still returns the successful mutation', async () => {
  const callbackError = new Error('Callback unavailable')
  afterMutationSuccess.mockRejectedValue(callbackError)

  const response = await POST(makeRequest(), { params })

  expect(response.status).toBe(200)
  expect(mockReportTelemetryError).toHaveBeenCalledWith(callbackError, {
    module: 'customers',
    code: 'customers.end_employment_guard_callback_failed',
    attributes: { guardId: '_legacy.crud-mutation-guard-service' },
  })
})
