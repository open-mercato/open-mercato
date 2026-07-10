import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim, WarrantyClaimLine, WarrantyVendorPolicy } from '../data/entities'
import type { VendorRecoveryInput } from '../data/validators'
import {
  buildVendorRecoveryCommandRequests,
  findVendorRecoveryMatches,
} from '../lib/vendorPolicyRecovery'

export const metadata = {
  event: 'warranty_claims.claim.status_changed',
  persistent: true,
  id: 'warranty_claims:auto-vendor-recovery',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type ResolverContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function resolveContainer(ctx: ResolverContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

function isBenignVendorRecoveryNoop(error: unknown): boolean {
  if (!isCrudHttpError(error)) return false
  if (error.status !== 400) return false
  return error.body.error === 'warranty_claims.errors.vendorRecoveryNeedsResolvedLines'
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  const record = toRecord(payload)
  const toStatus = readString(record, 'toStatus') ?? readString(record, 'status')
  if (toStatus !== 'resolved') return
  const payloadClaimType = readString(record, 'claimType')
  if (payloadClaimType === 'vendor_recovery') return

  const claimId = readString(record, 'claimId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!claimId || !tenantId || !organizationId) return

  const container = resolveContainer(ctx)
  const em = container.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }
  const claim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: claimId, tenantId, organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!claim || claim.claimType === 'vendor_recovery') return

  const lines = await findWithDecryption(
    em,
    WarrantyClaimLine,
    {
      claim: claim.id,
      tenantId,
      organizationId,
      lineStatus: 'resolved',
      vendorClaimLineId: null,
      vendorName: { $ne: null },
      deletedAt: null,
    },
    { orderBy: { lineNo: 'ASC' } },
    scope,
  )
  if (!lines.length) return

  const policies = await findWithDecryption(
    em,
    WarrantyVendorPolicy,
    {
      tenantId,
      organizationId,
      isActive: true,
      autoGenerateRecovery: true,
      deletedAt: null,
    },
    { orderBy: { vendorName: 'ASC', updatedAt: 'DESC' } },
    scope,
  )
  if (!policies.length) return

  const matches = findVendorRecoveryMatches({
    claim,
    lines,
    policies,
    autoOnly: true,
  })
  const requests = buildVendorRecoveryCommandRequests(claim.id, matches)
  if (!requests.length) return

  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }

  for (const request of requests) {
    const input: VendorRecoveryInput = {
      claimId: request.claimId,
      organizationId,
      tenantId,
      lineIds: request.lineIds,
      vendorName: request.vendorName,
      vendorRef: request.vendorRef,
    }
    try {
      await commandBus.execute<VendorRecoveryInput, { claimId: string }>(
        'warranty_claims.claim.create_vendor_recovery',
        { input, ctx: commandCtx },
      )
    } catch (error) {
      if (isBenignVendorRecoveryNoop(error)) continue
      throw error
    }
  }
}
