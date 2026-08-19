jest.mock('../../lib/connect-channel', () => ({
  createConnectedChannelRow: jest.fn(async (args: Record<string, unknown>) => ({ id: 'ch-new', ...args })),
  MailboxAlreadyConnectedError: class MailboxAlreadyConnectedError extends Error {},
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: 'cred-row' })),
}))
jest.mock('@open-mercato/core/modules/integrations/data/entities', () => ({
  IntegrationCredentials: class IntegrationCredentials {},
}))

import { createConnectedChannelRow } from '../../lib/connect-channel'
import connectCredentialChannelCommand from '../connect-credential-channel'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

type SavedScope = { tenantId: string; organizationId: string; userId?: string | null }

function buildCtx(adapter: Record<string, unknown>) {
  const em = { fork: () => em }
  const save = jest.fn(async () => undefined)
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'channelAdapterRegistry') return { get: () => adapter }
      if (token === 'integrationCredentialsService') return { save }
      throw new Error(`[internal] unexpected resolve(${token})`)
    },
  }
  return { ctx: { container } as never, save }
}

describe('connect-credential-channel scope', () => {
  beforeEach(() => jest.clearAllMocks())

  it('refuses a tenant-scoped provider that arrives with a per-user id (no channel minted)', async () => {
    const adapter = {
      providerKey: 'fcm',
      channelType: 'push',
      channelScope: 'tenant',
      capabilities: {},
      validateCredentials: async () => ({ ok: true }),
    }
    const { ctx, save } = buildCtx(adapter)
    const result = await connectCredentialChannelCommand.execute(
      {
        providerKey: 'fcm',
        displayName: 'FCM',
        credentials: { serviceAccountJson: '{}' },
        // A per-user session id on a tenant-scoped provider = the per-user route.
        // Must be refused, not silently downgraded (privilege-escalation guard).
        userId: USER_ID,
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      },
      ctx,
    )

    expect(result.status).toBe('wrong_scope_for_route')
    expect(save).not.toHaveBeenCalled()
    expect(createConnectedChannelRow as jest.Mock).not.toHaveBeenCalled()
  })

  it('connects a tenant-scoped provider via the tenant route (user_id null, creds pinned to tenantId)', async () => {
    const adapter = {
      providerKey: 'fcm',
      channelType: 'push',
      channelScope: 'tenant',
      capabilities: {},
      validateCredentials: async () => ({ ok: true }),
    }
    const { ctx, save } = buildCtx(adapter)
    const result = await connectCredentialChannelCommand.execute(
      {
        providerKey: 'fcm',
        displayName: 'FCM',
        credentials: { serviceAccountJson: '{}' },
        // Tenant route passes userId: null; org is the connecting admin's org.
        userId: null,
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      },
      ctx,
    )

    expect(result.status).toBe('connected')
    const savedScope = save.mock.calls[0][2] as SavedScope
    expect(savedScope.userId).toBeNull()
    // Credentials pinned to tenantId (not the connecting org) so a cross-org
    // reconnect overwrites the one row delivery reads.
    expect(savedScope.organizationId).toBe(TENANT_ID)
    const savedPayload = save.mock.calls[0][1] as Record<string, unknown>
    expect(savedPayload.userId).toBeUndefined()
    const rowArgs = (createConnectedChannelRow as jest.Mock).mock.calls[0][0] as {
      userId: string | null
      scope: { organizationId: string | null }
    }
    expect(rowArgs.userId).toBeNull()
    // Channel row stored org-agnostic (NULL) so the heal key stays stable.
    expect(rowArgs.scope.organizationId).toBeNull()
  })

  it('keeps user_id for a per-user provider', async () => {
    const adapter = {
      providerKey: 'imap',
      channelType: 'email',
      // channelScope omitted → defaults to per-user
      capabilities: { realtimePush: false },
      validateCredentials: async () => ({ ok: true }),
    }
    const { ctx, save } = buildCtx(adapter)
    const result = await connectCredentialChannelCommand.execute(
      {
        providerKey: 'imap',
        displayName: 'Work mail',
        credentials: { username: 'alice@example.com' },
        userId: USER_ID,
        scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      },
      ctx,
    )

    expect(result.status).toBe('connected')
    const savedScope = save.mock.calls[0][2] as SavedScope
    expect(savedScope.userId).toBe(USER_ID)
    const rowArgs = (createConnectedChannelRow as jest.Mock).mock.calls[0][0] as { userId: string | null }
    expect(rowArgs.userId).toBe(USER_ID)
  })
})
