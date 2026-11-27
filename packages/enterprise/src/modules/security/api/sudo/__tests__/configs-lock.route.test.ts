import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildOptimisticLockConflictBody } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { resolveSudoContext } from '../_shared'
import { DELETE, PUT } from '../configs/[id]/route'
import { POST } from '../configs/route'
import { requireSudo } from '../../../lib/sudo-middleware'

jest.mock('../_shared', () => ({
  ...jest.requireActual('../_shared'),
  resolveSudoContext: jest.fn(),
}))
jest.mock('../../../lib/sudo-middleware', () => ({
  ...jest.requireActual('../../../lib/sudo-middleware'),
  requireSudo: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const id = '11111111-1111-4111-8111-111111111111'
const params = { params: { id } }
const expectedUpdatedAt = '2026-11-27T12:00:00.000Z'
const currentUpdatedAt = '2026-11-27T12:00:01.000Z'
const execute = jest.fn()

function request(method: string, version?: string) {
  return new Request(`http://localhost/api/security/sudo/configs/${id}`, {
    method,
    headers: version === undefined ? undefined : { [OPTIMISTIC_LOCK_HEADER_NAME]: version },
    body: method === 'DELETE' ? undefined : JSON.stringify({ targetIdentifier: 'security.admin.mfa.reset', isEnabled: false }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveSudoContext).mockResolvedValue({
    container: { resolve: () => ({ execute }) },
    commandContext: {},
  } as never)
})

test.each([PUT, DELETE])('%p forwards the version after sudo validation and preserves the exact conflict', async (route) => {
  const conflict = buildOptimisticLockConflictBody(currentUpdatedAt, expectedUpdatedAt)
  execute.mockRejectedValueOnce(new CrudHttpError(409, conflict))
  const response = await route(request(route.name, expectedUpdatedAt), params)
  expect(requireSudo).toHaveBeenCalledWith(expect.any(Request), 'security.sudo.manage')
  expect(execute).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    input: expect.objectContaining({ id, expectedUpdatedAt }),
  }))
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual(conflict)
})

test.each([PUT, DELETE])('%p supports headerless clients and serializes only public fields', async (route) => {
  const body = route === PUT ? { ok: true, updatedAt: currentUpdatedAt } : { ok: true }
  const result = Object.defineProperty(body, Symbol('private'), { value: { before: true } })
  execute.mockResolvedValueOnce({ result })
  const response = await route(request(route.name), params)
  expect(execute.mock.calls[0][1].input.expectedUpdatedAt).toBeUndefined()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(body)
})

test.each(['', 'unparseable', 'a'.repeat(65), `${expectedUpdatedAt}, ${currentUpdatedAt}`])('rejects invalid version %j before dispatch', async (version) => {
  for (const route of [PUT, DELETE]) {
    const response = await route(request(route.name, version), params)
    expect(response.status).toBe(400)
  }
  expect(execute).not.toHaveBeenCalled()
})

test('rejects an expected version on create', async () => {
  const response = await POST(request('POST', expectedUpdatedAt))
  expect(response.status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
})
