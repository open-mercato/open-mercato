import { asValue, createContainer } from 'awilix'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { requireSudo } from '../../../lib/sudo-middleware'
import { DELETE, GET, PUT } from '../configs/[id]/route'
import { POST } from '../configs/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('../../../lib/sudo-middleware', () => ({
  requireSudo: jest.fn(),
  isSudoRequiredError: jest.fn(() => false),
}))

const id = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const orgId = '33333333-3333-4333-8333-333333333333'
const auth = { sub: 'user-1', tenantId, orgId }
const endpoint = 'https://example.test/api/security/sudo/configs'

const params = { params: Promise.resolve({ id }) }
const cases = [
  {
    method: 'POST',
    command: 'security.sudo.config.create',
    run: POST,
    body: { targetIdentifier: 'security.sudo.manage' },
    input: expect.objectContaining({ targetIdentifier: 'security.sudo.manage' }),
    result: { id },
    status: 201,
  },
  {
    method: 'PUT',
    command: 'security.sudo.config.update',
    run: (request: Request) => PUT(request, params),
    body: { isEnabled: false },
    input: { id, data: expect.objectContaining({ isEnabled: false }) },
    result: { ok: true },
    status: 200,
  },
  {
    method: 'DELETE',
    command: 'security.sudo.config.delete',
    run: (request: Request) => DELETE(request, params),
    body: undefined,
    input: { id },
    result: { ok: true },
    status: 200,
  },
] as const

const execute = jest.fn()
const getConfigById = jest.fn()

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue(auth)
  const container = createContainer()
  container.register({
    commandBus: asValue({ execute }),
    sudoChallengeService: asValue({ getConfigById }),
  })
  jest.mocked(createRequestContainer).mockResolvedValue(container as Awaited<ReturnType<typeof createRequestContainer>>)
})

test.each(cases)('$method checks sudo before dispatching the scoped command', async ({ method, command, run, body, input, result, status }) => {
  const request = new Request(endpoint, { method, body: JSON.stringify(body) })
  execute.mockImplementation(async () => {
    expect(requireSudo).toHaveBeenCalledWith(request, 'security.sudo.manage')
    return { result }
  })

  const response = await run(request)

  expect(response.status).toBe(status)
  await expect(response.json()).resolves.toEqual(result)
  expect(execute).toHaveBeenCalledWith(command, {
    input,
    ctx: expect.objectContaining({ auth, request, selectedOrganizationId: orgId, organizationIds: [orgId] }),
  })
})

test('a rejected sudo check never dispatches the update', async () => {
  const request = new Request(endpoint, { method: 'PUT', body: JSON.stringify({ label: 'New label' }) })
  jest.mocked(requireSudo).mockRejectedValueOnce(new CrudHttpError(403, { error: 'Forbidden' }))

  const response = await PUT(request, params)

  expect(response.status).toBe(403)
  expect(execute).not.toHaveBeenCalled()
})

test('the item route passes the authenticated scope and keeps missing rows indistinguishable', async () => {
  getConfigById.mockResolvedValueOnce(null)
  const response = await GET(new Request(endpoint), params)

  expect(response.status).toBe(404)
  expect(getConfigById).toHaveBeenCalledWith(id, { tenantId, organizationId: orgId, isSuperAdmin: false })
})
