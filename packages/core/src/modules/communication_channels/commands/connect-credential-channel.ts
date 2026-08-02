import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { ChannelAdapterRegistry } from '../lib/registry'
import { createConnectedChannelRow, MailboxAlreadyConnectedError } from '../lib/connect-channel'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'connect-credential-channel' })

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
  | { status: 'duplicate_mailbox'; externalIdentifier: string; existingProviderKey: string }

export const COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID =
  'communication_channels.channel.connect_credential'

type CredentialsServiceLike = {
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<string | void>
}

/**
 * Connect a per-user credential-based channel (IMAP, and future basic-auth providers).
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
        logger.warn('credentials persist failed for provider', { providerKey: input.providerKey, err })
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
            IntegrationCredentials,
            {
              integrationId: `channel_${input.providerKey}`,
              tenantId: credentialsScope.tenantId,
              organizationId: credentialsScope.organizationId,
              userId: credentialsScope.userId,
              deletedAt: null,
            },
            undefined,
            credentialsScope,
          )
          credentialsRefId = (row as { id?: string } | null)?.id ?? null
        } catch {
          credentialsRefId = null
        }
      }
    }

    // Mailbox identity for this channel: the email address. IMAP/SMTP credentials
    // carry it as `fromAddress`; other credential providers may use `username` or
    // `email`. Normalize emails to lowercase so the cross-provider duplicate guard
    // and the per-(tenant,user,provider,mailbox) heal index match canonically.
    const credBag = input.credentials as Record<string, unknown>
    const rawIdentifier =
      (typeof credBag.username === 'string' && credBag.username.length > 0 ? credBag.username : null) ??
      (typeof credBag.email === 'string' && credBag.email.length > 0 ? credBag.email : null) ??
      (typeof credBag.fromAddress === 'string' && credBag.fromAddress.length > 0
        ? credBag.fromAddress
        : null)
    const externalIdentifier =
      rawIdentifier && rawIdentifier.includes('@') ? rawIdentifier.toLowerCase() : rawIdentifier

    // Fail-safe: if credentials persistence failed (no `credentialsRef`), the
    // channel is created in `requires_reauth` + isActive=false so workers
    // don't poll a channel that has no usable credentials. The user can
    // reconnect to recover (see review R2-H4 / F6, 2026-05-26).
    const credentialsAvailable = credentialsRefId !== null
    let channel
    try {
      channel = await createConnectedChannelRow({
        em,
        adapter,
        providerKey: input.providerKey,
        displayName: input.displayName,
        externalIdentifier,
        credentialsRefId,
        userId: input.userId,
        scope: { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId ?? null },
        pollIntervalSeconds: input.pollIntervalSeconds,
      })
    } catch (err) {
      // Same mailbox already connected via another provider — reject so we don't
      // create a second channel that double-ingests every message.
      if (err instanceof MailboxAlreadyConnectedError) {
        return {
          status: 'duplicate_mailbox',
          externalIdentifier: err.externalIdentifier,
          existingProviderKey: err.existingProviderKey,
        }
      }
      throw err
    }

    // Spec C § Phase C5 — best-effort push registration for providers that
    // support it (Gmail). Failures persist as `pushStatus='failed'`
    // on the channel state but do NOT fail the connect — polling fallback
    // covers the channel until the operator clicks "Re-register push".
    // Imported lazily to avoid a circular module load (push-register reads
    // the channel adapter registry, which is initialised after this module).
    if (credentialsAvailable && input.providerKey === 'gmail') {
      const adapterSupportsPush =
        typeof adapter.registerPush === 'function' && typeof adapter.unregisterPush === 'function'
      const organizationId = input.scope.organizationId
      if (adapterSupportsPush && organizationId) {
        try {
          const { pushRegister } = await import('./push-register')
          await pushRegister({
            container: ctx.container,
            scope: {
              tenantId: input.scope.tenantId,
              organizationId,
              userId: input.userId,
            },
            input: { channelId: channel.id },
          })
        } catch (err) {
          // Never fail the connect on push errors — operator can manually
          // re-register via the dedicated route. Log + continue.
          logger.warn('best-effort pushRegister failed for channel', { channelId: channel.id, err })
        }
      }
    }

    return { status: 'connected', channelId: channel.id, externalIdentifier }
  },
}

registerCommand(connectCredentialChannelCommand)

export default connectCredentialChannelCommand
