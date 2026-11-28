import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { crudFormSectionHostKey } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { decodeCrudFormSectionPolicyToken } from '@open-mercato/shared/lib/crud/form-sections/policy-token'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { beforeAuth, metadata, openApi, POST } from '../route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/form-sections/manifest', () => ({ getCrudFormSectionManifest: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveFeatureCheckContext: jest.fn() }))

const uri = 'http://localhost/api/extensions/crud-form-sections/resolve'
const auth = { sub: 'staff', tenantId: 'tenant', orgId: 'organization' }
const address = { hostId: 'example.todo', formVariant: 'showcase', formOperation: 'update' } as const
const key = crudFormSectionHostKey(address)
const payload = {
  ...address,
  hostResourceKind: 'example.todo',
  hostResourceId: 'todo-1',
  clientManifestFingerprint: 'a'.repeat(64),
  clientRoundTripIds: ['example.host@v1'],
}
const authorizeHost = jest.fn()
const userHasAllFeatures = jest.fn()
const scopes = {
  scope: { tenantId: 'tenant', selectedId: 'organization', filterIds: ['organization'] },
  organizationId: 'organization',
  allowedOrganizationIds: ['organization'],
}

function request(body: unknown = payload): Request {
  return new Request(uri, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function expectPrivate(response: Response, status: number): void {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie, Authorization')
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue(auth)
  jest.mocked(createRequestContainer).mockResolvedValue({
    resolve: () => ({ userHasAllFeatures }),
  } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  jest.mocked(resolveFeatureCheckContext).mockResolvedValue(
    scopes as Awaited<ReturnType<typeof resolveFeatureCheckContext>>,
  )
  userHasAllFeatures.mockResolvedValue(true)
  authorizeHost.mockResolvedValue({ hostResourceKind: 'example.todo', hostResourceId: 'todo-1' })
  jest.mocked(getCrudFormSectionManifest).mockReturnValue({
    ledger: { hosts: [address], fingerprint: 'b'.repeat(64) },
    leafDefaultProviders: new Map(),
    providers: new Map([[key, {
      hostDescriptorId: 'example.host',
      hostResourceKind: 'example.todo',
      requireFeatures: ['example.manage'],
      authorizeHost,
    }]]),
    policies: new Map([[key, {
      hostDescriptorId: 'example.host',
      hostResourceKind: 'example.todo',
      surface: {
        ...address, id: 'example.composed', orderedSectionIds: ['notes', 'details'], callerIds: ['example.page'],
        contributionIds: [], ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
      },
      capabilities: [],
      bindings: [],
      requireFeatures: ['example.manage'],
      mutationSurfaces: [],
      mutationProviders: [],
      requiredLeaves: [],
      roundTripIds: payload.clientRoundTripIds,
      clientFingerprint: payload.clientManifestFingerprint,
    }]]),
  })
})

it('authorizes the scoped host before issuing an exact canonical result', async () => {
  expect(metadata).toEqual({ path: '/extensions/crud-form-sections/resolve', POST: { requireAuth: true } })
  expect(openApi.methods.POST?.errors?.map(({ status }) => status)).toEqual([400, 401, 403, 404, 413])
  const response = await POST(request())
  expectPrivate(response, 200)
  const body = await response.json()
  expect(body).toEqual({
    state: 'ready', fingerprint: 'b'.repeat(64), policyToken: expect.any(String),
    activeSectionIds: ['details', 'notes'], acceptedContributionIds: [],
  })
  expect(decodeCrudFormSectionPolicyToken(body.policyToken)?.orderedActiveSectionIds).toEqual(['notes', 'details'])
  expect(userHasAllFeatures).toHaveBeenCalledWith('staff', ['example.manage'], { tenantId: 'tenant', organizationId: 'organization' })
  expect(authorizeHost).toHaveBeenCalledWith(expect.objectContaining({
    address,
    scope: { tenantId: 'tenant', organizationId: 'organization', allowedOrganizationIds: ['organization'] },
    requestedHost: { hostResourceKind: 'example.todo', hostResourceId: 'todo-1' },
  }))
})

it('blocks stale bundles with the same non-leaking policy failure after scoped authorization', async () => {
  const response = await POST(request({ ...payload, clientManifestFingerprint: 'c'.repeat(64) }))
  expectPrivate(response, 200)
  expect(await response.json()).toEqual({ state: 'failed', code: 'crud_form_section_policy_invalid' })
  expect(authorizeHost).toHaveBeenCalledTimes(1)
})

it('preserves auth, feature and scoped not-found precedence', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValueOnce(null)
  expectPrivate(await POST(request()), 401)
  userHasAllFeatures.mockResolvedValueOnce(false)
  expectPrivate(await POST(request()), 403)
  authorizeHost.mockResolvedValueOnce(null)
  expectPrivate(await POST(request()), 404)
  authorizeHost.mockResolvedValueOnce({ hostResourceKind: 'example.todo', hostResourceId: 'different' })
  expectPrivate(await POST(request()), 404)
})

it.each([
  { tenantId: 'untrusted' },
  { clientRoundTripIds: ['example.z@v1', 'example.a@v1'] },
  { clientRoundTripIds: ['example.host@v1', 'example.host@v1'] },
  { hostResourceId: undefined },
  { formOperation: 'create' },
  { hostResourceId: 'comma,inside' },
])('rejects malformed, ambiguous or noncanonical bodies before scope resolution (%j)', async (malformed) => {
  expectPrivate(await POST(request({ ...payload, ...malformed })), 400)
  expect(resolveFeatureCheckContext).not.toHaveBeenCalled()
})

it('rejects an oversized streamed body without waiting for the other clone branch', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a'.repeat(16385)))
      controller.close()
    },
  })
  const options: RequestInit & { duplex: 'half' } = {
    method: 'POST', headers: { 'content-type': 'application/json' }, duplex: 'half', body: stream,
  }
  const streamed = new Request(uri, options)
  const result = await beforeAuth(streamed)
  if (!result) throw new Error('[internal] Expected the body limit to return an error')
  expectPrivate(result, 413)
  await streamed.body?.cancel()
})
