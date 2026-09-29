import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim } from '../data/entities'
import type { ClaimCreateInput } from '../data/validators'
import { isUniqueViolation } from './externalIntake'

type EmailIntakeScope = {
  tenantId: string
  organizationId: string
}

export type CreateOrGetClaimFromInboundMessageArgs = {
  em: EntityManager
  container: AwilixContainer
  scope: EmailIntakeScope
  contactEmail: string
  customerName?: string | null
  subject?: string | null
  body?: string | null
  intakeMessageRef: string
}

export type EmailIntakeResult = {
  claimId: string
  created: boolean
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`[internal] ${fieldName} is required for warranty claim email intake`)
  return normalized
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function buildNotes(subject: string | null, body: string | null): string | null {
  const parts: string[] = []
  if (subject) parts.push(`Subject: ${subject}`)
  if (body) parts.push(body)
  const notes = parts.join('\n\n').trim()
  return notes.length > 0 ? notes.slice(0, 8000) : null
}

async function loadClaimByIntakeMessageRef(
  em: EntityManager,
  scope: EmailIntakeScope,
  intakeMessageRef: string,
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      intakeMessageRef,
      deletedAt: null,
    },
    {},
    scope,
  )
}

function buildCommandCtx(container: AwilixContainer, scope: EmailIntakeScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    syncOrigin: 'warranty_claims.email_intake',
    systemActor: true,
  }
}

export async function createOrGetClaimFromInboundMessage(
  args: CreateOrGetClaimFromInboundMessageArgs,
): Promise<EmailIntakeResult> {
  const contactEmail = normalizeRequired(args.contactEmail, 'contactEmail')
  const intakeMessageRef = normalizeRequired(args.intakeMessageRef, 'intakeMessageRef')

  const existing = await loadClaimByIntakeMessageRef(args.em, args.scope, intakeMessageRef)
  if (existing) return { claimId: existing.id, created: false }

  const commandBus = args.container.resolve<CommandBus>('commandBus')
  const commandCtx = buildCommandCtx(args.container, args.scope)
  const subject = trimOptional(args.subject)
  const body = trimOptional(args.body)
  const createInput: ClaimCreateInput = {
    tenantId: args.scope.tenantId,
    organizationId: args.scope.organizationId,
    claimType: 'warranty',
    channel: 'api',
    priority: 'normal',
    customerId: null,
    customerName: trimOptional(args.customerName) ?? contactEmail,
    contactEmail,
    intakeMessageRef,
    notes: buildNotes(subject, body),
  }

  try {
    const { result } = await commandBus.execute<ClaimCreateInput, { claimId: string }>(
      'warranty_claims.claim.create',
      { input: createInput, ctx: commandCtx },
    )
    if (!result?.claimId) {
      throw new Error('[internal] warranty claim email intake create failed')
    }
    return { claimId: result.claimId, created: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await loadClaimByIntakeMessageRef(args.em, args.scope, intakeMessageRef)
      if (winner) return { claimId: winner.id, created: false }
    }
    throw err
  }
}
