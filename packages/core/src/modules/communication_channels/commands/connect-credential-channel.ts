import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { ChannelAdapterRegistry } from '../lib/registry'
import { CommunicationChannel } from '../data/entities'

const connectCredentialChannelSchema = z.object({
  providerKey: z.string().min(1).max(64),
  displayName: z.string().min(1).max(255),
  /** Provider-specific credential fields — opaque to the hub; the adapter validates. */
  credentials: z.record(z.string(), z.unknown()),
  /** Optional polling interval (seconds) — set when adapter is polling-based. */
  pollIntervalSeconds: z.number().int().positive().max(86_400).optional(),
  userId: z.string().uuid(),
  scope: z.object({
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
  }),
})

export type ConnectCredentialChannelInput = z.infer<typeof connectCredentialChannelSchema>

export type ConnectCredentialChannelResult =
  | { status: 'connected'; channelId: string; externalIdentifier: string | null }
  | { status: 'validation_failed'; errors: Record<string, string> }
  | { status: 'no_adapter'; reason: string }

export const COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID =
  'communication_channels.connect_credential_channel'

type CredentialsServiceLike = {
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<string | void>
}

/**
 * Connect a per-user credential-based channel (IMAP, future Microsoft Basic Auth).
 *
 * Flow:
 *   1. Resolve the adapter for `providerKey`.
 *   2. Call `adapter.validateCredentials?` — adapters that don't implement it
 *      are accepted optimistically (the hub trusts the adapter to fail on first
 *      use). Adapters with the method return field-level errors via Zod-like
 *      `{ ok: false, errors: { fieldName: 'message' } }`; we forward those to
 *      the caller for `createCrudFormError`.
 *   3. Persist the credentials encrypted via `integrationCredentialsService.save?` if available.
 *   4. Create the `CommunicationChannel` row with `userId = currentUser.id`,
 *      `status = 'connected'`, and the adapter's declared capabilities snapshot.
 *
 * The route handler binds the `userId` field from the authenticated session;
 * the command refuses inputs whose `userId` doesn't pass UUID validation.
 */
const connectCredentialChannelCommand: CommandHandler<
  ConnectCredentialChannelInput,
  ConnectCredentialChannelResult
> = {
  id: COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = connectCredentialChannelSchema.parse(rawInput) as ConnectCredentialChannelInput
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const adapterRegistry = ctx.container.resolve('channelAdapterRegistry') as ChannelAdapterRegistry
    const adapter = adapterRegistry.get(input.providerKey)
    if (!adapter) {
      return {
        status: 'no_adapter',
        reason: `No adapter registered for provider '${input.providerKey}'`,
      }
    }

    // Optional credential validation.
    if (typeof adapter.validateCredentials === 'function') {
      const validation = await adapter.validateCredentials({
        providerKey: input.providerKey,
        credentials: input.credentials,
        scope: {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId ?? input.scope.tenantId,
        },
      })
      if (!validation.ok) {
        return {
          status: 'validation_failed',
          errors: validation.errors ?? { _form: 'Credential validation failed' },
        }
      }
    }

    // Persist credentials best-effort.
    let credentialsService: CredentialsServiceLike | null = null
    try {
      credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsServiceLike
    } catch {
      credentialsService = null
    }
    // Arg order MUST be (integrationId, credentials, scope) — matches the real
    // CredentialsService signature. The legacy reversed order swapped the scope
    // object into the credentials field; see review C1 (2026-05-26).
    //
    // `scope.userId` is set so the credentials service writes a per-user row.
    // Without this, two users on the same tenant share one credentials row
    // (see review R2-C1 / N1, 2026-05-26).
    const credentialsScope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? input.scope.tenantId,
      userId: input.userId,
    }
    let credentialsRefId: string | null = null
    let credentialsPersisted = false
    if (credentialsService?.save) {
      try {
        await credentialsService.save(
          `channel_${input.providerKey}`,
          { ...input.credentials, userId: input.userId },
          credentialsScope,
        )
        credentialsPersisted = true
      } catch (err) {
        console.warn(
          `[communication_channels:connect_credential] credentials persist failed for ${input.providerKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
      // Resolve the saved row id so we can link channel.credentialsRef. Best-effort.
      if (credentialsPersisted) {
        try {
          const { IntegrationCredentials } = await import(
            '@open-mercato/core/modules/integrations/data/entities'
          )
          const { findOneWithDecryption } = await import(
            '@open-mercato/shared/lib/encryption/find'
          )
          const row = await findOneWithDecryption(
            em,
            IntegrationCredentials as any,
            {
              integrationId: `channel_${input.providerKey}`,
              tenantId: credentialsScope.tenantId,
              organizationId: credentialsScope.organizationId,
              userId: credentialsScope.userId,
              deletedAt: null,
            } as any,
            undefined,
            credentialsScope,
          )
          credentialsRefId = (row as { id?: string } | null)?.id ?? null
        } catch {
          credentialsRefId = null
        }
      }
    }

    const externalIdentifier =
      typeof (input.credentials as { username?: string }).username === 'string'
        ? ((input.credentials as { username?: string }).username as string)
        : typeof (input.credentials as { email?: string }).email === 'string'
          ? ((input.credentials as { email?: string }).email as string)
          : null

    const pollIntervalSeconds =
      input.pollIntervalSeconds ??
      (adapter.capabilities?.realtimePush === false ? 300 : null)

    // Fail-safe: if credentials persistence failed (no `credentialsRef`), the
    // channel is created in `requires_reauth` + isActive=false so workers
    // don't poll a channel that has no usable credentials. The user can
    // reconnect to recover (see review R2-H4 / F6, 2026-05-26).
    const credentialsAvailable = credentialsRefId !== null
    const channel = em.create(CommunicationChannel, {
      providerKey: input.providerKey,
      channelType: adapter.channelType,
      displayName: input.displayName,
      externalIdentifier,
      credentialsRef: credentialsRefId,
      capabilities: adapter.capabilities as unknown as Record<string, unknown>,
      isActive: credentialsAvailable,
      userId: input.userId,
      isPrimary: false,
      pollIntervalSeconds,
      status: credentialsAvailable ? 'connected' : 'requires_reauth',
      lastError: credentialsAvailable ? null : 'credentials_persist_failed',
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId ?? null,
    } as any)
    em.persist(channel)
    await em.flush()

    return { status: 'connected', channelId: channel.id, externalIdentifier }
  },
}

registerCommand(connectCredentialChannelCommand as unknown as CommandHandler)

export default connectCredentialChannelCommand
