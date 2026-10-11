import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PHONE_CALL_RESOURCE_KIND } from '@open-mercato/shared/modules/phone_calls/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { PhoneCall, PhoneCallParticipant } from '../data/entities'
import {
  ingestPhoneCallSchema,
  type IngestPhoneCallInput,
} from '../data/validators'
import { emitPhoneCallsEvent } from '../events'

export const PHONE_CALLS_CALL_INGEST_COMMAND_ID = 'phone_calls.call.ingest'
export { PHONE_CALL_RESOURCE_KIND }

const phoneCallCrudIndexer: CrudIndexerConfig<PhoneCall> = {
  entityType: E.phone_calls.phone_call,
}

// The list route derives its cache tag from the entity class name, and the tag the bus
// derives from this command id is a different one, so without the alias the cached list
// pages survive an ingest.
const PHONE_CALL_CACHE_ALIASES = [PhoneCall.name]

export type IngestPhoneCallResult = { phoneCallId: string; created: boolean }

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
  // Replace the whole participant set on every ingest: participants have no reliable
  // natural key (providerParticipantId/phoneNumber are often null), so a diff/upsert would
  // be guesswork. Delete-all + insert stays deterministic and idempotent. Revisit this if
  // anything starts referencing participant.id externally (re-pull rotates these ids).
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

const ingestPhoneCallCommand: CommandHandler<IngestPhoneCallInput, IngestPhoneCallResult> = {
  id: PHONE_CALLS_CALL_INGEST_COMMAND_ID,
  async execute(rawInput, ctx) {
    const input = ingestPhoneCallSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await findOneWithDecryption(
      em,
      PhoneCall,
      {
        providerKey: input.providerKey,
        externalCallId: input.externalCallId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
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

    // The module emits its own declared events, so only the indexer is handed to the
    // shared side effects: the query index and the read caches have to see the write.
    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: created ? 'created' : 'updated',
      entity: call,
      identifiers: {
        id: call.id,
        organizationId: call.organizationId,
        tenantId: call.tenantId,
      },
      indexer: phoneCallCrudIndexer,
    })

    await emitPhoneCallsEvent(
      created ? 'phone_calls.call.ingested' : 'phone_calls.call.updated',
      { id: call.id, organizationId: call.organizationId, tenantId: call.tenantId },
    ).catch(() => undefined)

    return { phoneCallId: call.id, created }
  },
  // Calls carry PII (numbers, names, recordings), so the audit entry stays at identifiers
  // and the ingest outcome. No snapshot, and the command is not undoable.
  buildLog: async ({ input, result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: result.created
        ? translate('phone_calls.audit.calls.ingested', 'Ingest phone call')
        : translate('phone_calls.audit.calls.updated', 'Update ingested phone call'),
      resourceKind: PHONE_CALL_RESOURCE_KIND,
      resourceId: result.phoneCallId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      context: { cacheAliases: PHONE_CALL_CACHE_ALIASES },
    }
  },
}

registerCommand(ingestPhoneCallCommand)

export { ingestPhoneCallCommand }
