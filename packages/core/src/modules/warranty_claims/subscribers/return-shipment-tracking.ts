import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { Kysely } from 'kysely'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TransitionClaimInput } from '../data/validators'

const logger = createLogger('warranty_claims')
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export const metadata = {
  event: 'shipping_carriers.shipment.delivered',
  persistent: true,
  id: 'warranty_claims:return-shipment-tracking',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

type ReturnTrackingDb = {
  carrier_shipments: {
    id: string
    tracking_number: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  warranty_claims: {
    id: string
    claim_number: string
    updated_at: Date | null
    status: string
    return_tracking_number: string | null
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveContainer(ctx: SubscriberContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

function isMissingReferenceTableError(error: unknown): boolean {
  const candidate = toRecord(error)
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string' && /relation "[^"]*" does not exist/.test(candidate.message))
}

function isInvalidTransitionError(error: unknown): boolean {
  if (isCrudHttpError(error)) {
    return error.status === 400 && error.body.error === 'warranty_claims.errors.invalidTransition'
  }
  const candidate = toRecord(error)
  const body = toRecord(candidate.body)
  return candidate.status === 400 && body.error === 'warranty_claims.errors.invalidTransition'
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const shipmentId = readString(record, 'shipmentId') ?? readString(record, 'shipment_id')
  const payloadTenantId = readString(record, 'tenantId') ?? readString(record, 'tenant_id')
  const payloadOrganizationId = readString(record, 'organizationId')
    ?? readString(record, 'organization_id')

  if (!shipmentId || !payloadTenantId || !payloadOrganizationId) {
    logger.debug('[warranty_claims:return-shipment-tracking] skipped incomplete delivered payload', {
      hasShipmentId: Boolean(shipmentId),
      hasTenantId: Boolean(payloadTenantId),
      hasOrganizationId: Boolean(payloadOrganizationId),
    })
    return
  }

  const tenantId = ctx.tenantId ?? payloadTenantId
  const organizationId = ctx.organizationId ?? payloadOrganizationId
  const container = resolveContainer(ctx)
  let db: Kysely<ReturnTrackingDb>
  try {
    const em = container.resolve<EntityManager>('em').fork()
    db = em.getKysely<ReturnTrackingDb>()
  } catch (error) {
    logger.error('[warranty_claims:return-shipment-tracking] failed to initialize persistence', {
      err: error,
      shipmentId,
      tenantId,
      organizationId,
    })
    throw error
  }
  let shipment: { tracking_number: string | null } | undefined
  try {
    shipment = await db
      .selectFrom('carrier_shipments')
      .select('tracking_number')
      .where('id', '=', shipmentId)
      .where('tenant_id', '=', tenantId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  } catch (error) {
    if (isMissingReferenceTableError(error)) {
      logger.debug('[warranty_claims:return-shipment-tracking] carrier shipment table unavailable', {
        shipmentId,
        tenantId,
        organizationId,
      })
      return
    }
    logger.error('[warranty_claims:return-shipment-tracking] failed to load carrier shipment', {
      err: error,
      shipmentId,
      tenantId,
      organizationId,
    })
    throw error
  }

  const trackingNumber = readString(toRecord(shipment), 'tracking_number')
  if (!shipment || !trackingNumber) {
    logger.debug('[warranty_claims:return-shipment-tracking] shipment or tracking number not found', {
      shipmentId,
      tenantId,
      organizationId,
    })
    return
  }

  let claims: Array<{ id: string; claim_number: string; updated_at: Date | null }>
  try {
    claims = await db
      .selectFrom('warranty_claims')
      .select(['id', 'claim_number', 'updated_at'])
      .where('tenant_id', '=', tenantId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'awaiting_return')
      .where('return_tracking_number', '=', trackingNumber)
      .limit(2)
      .execute()
  } catch (error) {
    logger.error('[warranty_claims:return-shipment-tracking] failed to find matching warranty claims', {
      err: error,
      shipmentId,
      tenantId,
      organizationId,
    })
    throw error
  }

  if (claims.length === 0) {
    logger.debug('[warranty_claims:return-shipment-tracking] no awaiting-return claim matched shipment', {
      shipmentId,
      tenantId,
      organizationId,
    })
    return
  }
  if (claims.length > 1) {
    logger.warn('[warranty_claims:return-shipment-tracking] multiple claims matched return shipment', {
      shipmentId,
      tenantId,
      organizationId,
      claimNumbers: claims.map((claim) => claim.claim_number),
    })
    return
  }

  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: {
      sub: SYSTEM_USER_ID,
      tenantId,
      orgId: organizationId,
    },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    systemActor: true,
  }
  const input: TransitionClaimInput = {
    id: claims[0].id,
    toStatus: 'received',
    systemNote: 'warranty_claims.timeline.autoReceivedFromTracking',
  }

  try {
    const commandBus = container.resolve<CommandBus>('commandBus')
    await commandBus.execute<TransitionClaimInput, { claimId: string }>(
      'warranty_claims.claim.transition',
      { input, ctx: commandCtx },
    )
  } catch (error) {
    if (isInvalidTransitionError(error)) {
      logger.debug('[warranty_claims:return-shipment-tracking] claim no longer accepts received transition', {
        claimId: claims[0].id,
        shipmentId,
        tenantId,
        organizationId,
      })
      return
    }
    logger.error('[warranty_claims:return-shipment-tracking] failed to transition matching warranty claim', {
      err: error,
      claimId: claims[0].id,
      shipmentId,
      tenantId,
      organizationId,
    })
    throw error
  }
}
