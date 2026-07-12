import { buildDocumentsCommandRuntimeContext } from '../api/_commands'
import { resolveActorUserId, type DocumentsRouteContext } from '../api/_shared'
import { resolveDocumentsCommandActor } from '../commands/shared'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const KEY_ID = '22222222-2222-4222-8222-222222222222'
const KEY_SUBJECT = `api_key:${KEY_ID}`
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_KEY_ID = '55555555-5555-4555-8555-555555555555'

function makeContext(authOverrides: Record<string, unknown> = {}): DocumentsRouteContext {
  return {
    container: {} as DocumentsRouteContext['container'],
    em: {} as DocumentsRouteContext['em'],
    auth: {
      sub: KEY_SUBJECT,
      keyId: KEY_ID,
      userId: USER_ID,
      isApiKey: true,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      features: ['documents.edit'],
      roleIds: [],
      ...authOverrides,
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    request: new Request('http://localhost/api/documents'),
  }
}

describe('Documents command runtime identity', () => {
  it('keeps the API-key subject for ACL while using its backing user as the domain actor', () => {
    const runtime = buildDocumentsCommandRuntimeContext(makeContext())

    expect(runtime).toMatchObject({
      auth: { sub: KEY_SUBJECT, userId: USER_ID },
      selectedOrganizationId: ORGANIZATION_ID,
      organizationIds: [ORGANIZATION_ID],
    })
    expect(resolveDocumentsCommandActor(runtime)).toBe(USER_ID)
  })

  it('uses the validated key UUID for an unbound API key', () => {
    const runtime = buildDocumentsCommandRuntimeContext(makeContext({ userId: undefined }))

    expect(runtime).toMatchObject({
      auth: { sub: KEY_SUBJECT, keyId: KEY_ID },
    })
    expect(resolveDocumentsCommandActor(runtime)).toBe(KEY_ID)
  })

  it.each([
    ['missing keyId', { keyId: undefined }],
    ['subject/keyId mismatch', { keyId: OTHER_KEY_ID }],
    ['malformed backing user', { userId: 'not-a-uuid' }],
  ])('fails closed for %s instead of deriving an actor from the subject', (_label, overrides) => {
    const context = makeContext(overrides)
    expect(() => resolveActorUserId(context.auth)).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => resolveDocumentsCommandActor({
      auth: context.auth,
    } as CommandRuntimeContext)).toThrow(expect.objectContaining({ status: 403 }))
  })
})
