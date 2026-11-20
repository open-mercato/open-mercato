import { GET, metadata as listMetadata } from '../reconciliations/route'
import { POST, metadata as resolveMetadata } from '../reconciliations/[id]/resolve/route'
import { resolveReconciliationCommand } from '../../commands/reconciliation'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'

const mockResolve = jest.fn()
const mockList = jest.fn()
const mockExecute = jest.fn()
const mockGuard = jest.fn()
const mockAfter = jest.fn()
const mockResolveCase = jest.fn()
const mockPermission = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: mockResolve }) }))
jest.mock('../../lib/reconciliation', () => ({
  listReconciliations: (...args: unknown[]) => mockList(...args),
  resolveReconciliation: (...args: unknown[]) => mockResolveCase(...args),
}))
jest.mock('../guards', () => ({
  resolveUserFeatures: () => [],
  runPaymentGatewayMutationGuards: (...args: unknown[]) => mockGuard(...args),
  runPaymentGatewayMutationGuardAfterSuccess: (...args: unknown[]) => mockAfter(...args),
}))

const auth = { sub: 'finance-user', tenantId: 'tenant', orgId: 'organization' }
const id = '00000000-0000-4000-8000-000000000001'
const evidence = { refundReference: 'receipt-fixture', refundedAmountExact: '100', currencyCode: 'USD', confirmedAt: new Date(Date.now() - 1000).toISOString(), confirmed: true as const }
const request = (body: unknown = evidence) => new Request('http://localhost/api/payment_gateways/reconciliations', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockImplementation((key: string) => {
    if (key === 'commandBus') return { execute: mockExecute }
    if (key === 'rbacService') return { userHasAllFeatures: mockPermission }
    if (key === 'em') return {}
    throw new Error('[internal] Unexpected service')
  })
  mockGuard.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  mockExecute.mockResolvedValue({ result: { id } })
  mockPermission.mockResolvedValue(true)
  mockResolveCase.mockResolvedValue({ id })
  mockList.mockResolvedValue({ items: [], total: 0 })
})

it('retains existing view and refund permissions', () => {
  expect(listMetadata.GET.requireFeatures).toEqual(['payment_gateways.view'])
  expect(resolveMetadata.POST.requireFeatures).toEqual(['payment_gateways.refund'])
})

it('rejects unauthenticated reads and invalid pagination without querying', async () => {
  expect((await GET(new Request('http://localhost'), { auth: null })).status).toBe(401)
  expect((await GET(new Request('http://localhost/?pageSize=101'), { auth })).status).toBe(422)
  expect(mockList).not.toHaveBeenCalled()
})

it('derives read scope from authentication rather than caller query parameters', async () => {
  await GET(new Request('http://localhost/?tenantId=foreign&status=resolved'), { auth })
  expect(mockList).toHaveBeenCalledWith(expect.anything(), { tenantId: auth.tenantId, organizationId: auth.orgId }, expect.objectContaining({ status: 'resolved' }))
})

it('validates confirmation and UUID before entering mutation guards', async () => {
  expect((await POST(request({ ...evidence, confirmed: false }), { auth, params: { id } })).status).toBe(422)
  expect((await POST(request(), { auth, params: { id: 'invalid' } })).status).toBe(422)
  expect(mockGuard).not.toHaveBeenCalled()
  expect(mockExecute).not.toHaveBeenCalled()
})

it('preserves guard rejection and executes callbacks only after the audited command', async () => {
  mockGuard.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'fixture guard' } })
  expect((await POST(request(), { auth, params: { id } })).status).toBe(423)
  expect(mockExecute).not.toHaveBeenCalled()
  expect((await POST(request(), { auth, params: { id } })).status).toBe(200)
  expect(mockExecute).toHaveBeenCalledWith('payment_gateways.reconciliation.resolve', expect.objectContaining({ input: { id, evidence }, ctx: expect.objectContaining({ auth }) }))
  expect(mockAfter).toHaveBeenCalledTimes(1)
})

it('revalidates modified guard payloads', async () => {
  mockGuard.mockResolvedValue({ ok: true, modifiedPayload: { ...evidence, confirmed: false }, afterSuccessCallbacks: [] })
  expect((await POST(request(), { auth, params: { id } })).status).toBe(422)
  expect(mockExecute).not.toHaveBeenCalled()
})

it('forwards explicit command-interceptor HTTP refusals and leaves unexpected failures to the error funnel', async () => {
  const body = { error: 'fixture policy refusal', code: 'fixture_refused' }
  mockExecute.mockRejectedValueOnce(new CommandInterceptorError('fixture policy refusal', { status: 422, body }))
  const refusal = await POST(request(), { auth, params: { id } })
  expect(refusal.status).toBe(422)
  expect(await refusal.json()).toEqual(body)
  expect(mockAfter).not.toHaveBeenCalled()
  const unexpected = new Error('[internal] fixture database unavailable')
  mockExecute.mockRejectedValueOnce(unexpected)
  await expect(POST(request(), { auth, params: { id } })).rejects.toBe(unexpected)
})

it('enforces refund permission at the command boundary as well', async () => {
  const context = { auth, container: { resolve: mockResolve } } as unknown as CommandRuntimeContext
  mockPermission.mockResolvedValue(false)
  await expect(resolveReconciliationCommand.execute({ id, evidence }, context)).rejects.toMatchObject({ status: 403 })
  expect(mockResolveCase).not.toHaveBeenCalled()
  await expect(resolveReconciliationCommand.execute({ id, evidence }, { ...context, auth: { ...auth, isApiKey: true } })).rejects.toMatchObject({ status: 403 })
  mockPermission.mockResolvedValue(true)
  await resolveReconciliationCommand.execute({ id, evidence }, context)
  expect(mockResolveCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: auth.sub, scope: { tenantId: auth.tenantId, organizationId: auth.orgId } }))
})
