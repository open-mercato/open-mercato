import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getPhoneCallProvider } from '@open-mercato/shared/modules/phone_calls/provider'
import type { NormalizedPhoneCall, PhoneCallProviderScope } from '@open-mercato/shared/modules/phone_calls/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { PhoneCall, PhoneCallParticipant } from '../data/entities'
import {
  ingestPhoneCallSchema,
  pullProviderSchema,
  type IngestPhoneCallInput,
  type PullProviderInput,
} from '../data/validators'
import { emitPhoneCallsEvent } from '../events'

export const PHONE_CALLS_CALL_INGEST_COMMAND_ID = 'phone_calls.call.ingest'
export const PHONE_CALLS_PROVIDER_PULL_COMMAND_ID = 'phone_calls.provider.pull'

export type IngestPhoneCallResult = { phoneCallId: string; created: boolean }
export type PullProviderResult = {
  created: number
  updated: number
  ignored: number
  failed: number
  nextCursor: string | null
}

function applyScalarFields(call: PhoneCall, input: IngestPhoneCallInput, ingestedAt: Date): void {
  call.integrationId = input.integrationId ?? null
  call.externalConversationId = input.externalConversationId ?? null
  call.direction = input.direction
  call.status = input.status
  call.startedAt = input.startedAt ?? null
  call.answeredAt = input.answeredAt ?? null
  call.endedAt = input.endedAt ?? null
  call.durationSeconds = input.durationSeconds ?? null
  call.recordingUrl = input.recording?.url ?? null
  call.providerFacts = input.providerFacts ?? null
  call.rawSnapshot = input.rawPayload
  call.ingestStatus = 'complete'
  call.lastIngestedAt = ingestedAt
}

async function syncParticipants(
  em: EntityManager,
  call: PhoneCall,
  input: IngestPhoneCallInput,
): Promise<void> {
  await em.nativeDelete(PhoneCallParticipant, { phoneCallId: call.id })
  for (const participant of input.participants) {
    em.persist(em.create(PhoneCallParticipant, {
      organizationId: call.organizationId,
      tenantId: call.tenantId,
      phoneCallId: call.id,
      providerParticipantId: participant.providerParticipantId ?? null,
      role: participant.role,
      phoneNumber: participant.phoneNumber ?? null,
      displayName: participant.displayName ?? null,
      email: participant.email ?? null,
      metadata: participant.metadata ?? null,
    }))
  }
}

function mapNormalizedToIngestInput(
  call: NormalizedPhoneCall,
  scope: { providerKey: string; integrationId: string | null; organizationId: string; tenantId: string },
): IngestPhoneCallInput {
  return {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    providerKey: scope.providerKey,
    integrationId: scope.integrationId,
    externalCallId: call.externalCallId,
    externalConversationId: call.externalConversationId ?? null,
    direction: call.direction,
    status: call.status,
    participants: call.participants.map((participant) => ({
      role: participant.role,
      providerParticipantId: participant.providerParticipantId ?? null,
      phoneNumber: participant.phoneNumber ?? null,
      displayName: participant.displayName ?? null,
      email: participant.email ?? null,
      metadata: participant.metadata,
    })),
    recording: call.recording ?? null,
    startedAt: call.startedAt ?? null,
    answeredAt: call.answeredAt ?? null,
    endedAt: call.endedAt ?? null,
    durationSeconds: call.durationSeconds ?? null,
    providerFacts: call.providerFacts,
    rawPayload: call.rawPayload,
  }
}

async function resolveProviderCredentials(
  ctx: CommandRuntimeContext,
  integrationId: string | null,
  scope: PhoneCallProviderScope,
): Promise<Record<string, unknown>> {
  if (!integrationId) return {}
  const credentialsService = ctx.container.resolve('integrationCredentialsService') as CredentialsService
  return (await credentialsService.resolve(integrationId, scope)) ?? {}
}

const ingestPhoneCallCommand: CommandHandler<IngestPhoneCallInput, IngestPhoneCallResult> = {
  id: PHONE_CALLS_CALL_INGEST_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = ingestPhoneCallSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(PhoneCall, {
      providerKey: input.providerKey,
      externalCallId: input.externalCallId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const created = !existing
    const call = existing ?? em.create(PhoneCall, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      providerKey: input.providerKey,
      externalCallId: input.externalCallId,
      direction: input.direction,
      status: input.status,
    })
    if (created) em.persist(call)
    const ingestedAt = new Date()

    await withAtomicFlush(
      em,
      [
        () => applyScalarFields(call, input, ingestedAt),
        () => syncParticipants(em, call, input),
      ],
      { transaction: true, label: PHONE_CALLS_CALL_INGEST_COMMAND_ID },
    )

    await emitPhoneCallsEvent(
      created ? 'phone_calls.call.ingested' : 'phone_calls.call.updated',
      { id: call.id, organizationId: call.organizationId, tenantId: call.tenantId },
    ).catch(() => undefined)

    return { phoneCallId: call.id, created }
  },
}

const pullProviderCommand: CommandHandler<PullProviderInput, PullProviderResult> = {
  id: PHONE_CALLS_PROVIDER_PULL_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = pullProviderSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const provider = getPhoneCallProvider(input.providerKey)
    if (!provider) {
      throw new CrudHttpError(400, { error: `[internal] Phone call provider "${input.providerKey}" is not registered` })
    }

    const scope: PhoneCallProviderScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const integrationId = input.integrationId ?? null
    const credentials = await resolveProviderCredentials(ctx, integrationId, scope)

    const batch = await provider.fetchCalls({
      credentials,
      scope,
      integrationId,
      from: input.from ?? null,
      to: input.to ?? null,
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
    })

    let created = 0
    let updated = 0
    let failed = 0
    for (const normalized of batch.calls) {
      try {
        const result = await ingestPhoneCallCommand.execute(
          mapNormalizedToIngestInput(normalized, {
            providerKey: input.providerKey,
            integrationId,
            organizationId: input.organizationId,
            tenantId: input.tenantId,
          }),
          ctx,
        )
        if (result.created) created += 1
        else updated += 1
      } catch {
        failed += 1
        await emitPhoneCallsEvent('phone_calls.call.ingest_failed', {
          providerKey: input.providerKey,
          externalCallId: normalized.externalCallId,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
        }).catch(() => undefined)
      }
    }

    return { created, updated, ignored: 0, failed, nextCursor: batch.nextCursor ?? null }
  },
}

registerCommand(ingestPhoneCallCommand)
registerCommand(pullProviderCommand)

export { ingestPhoneCallCommand, pullProviderCommand }
