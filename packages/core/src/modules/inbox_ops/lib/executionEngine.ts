import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { EventBus } from '@open-mercato/events/types'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { InboxProposal, InboxProposalAction, InboxDiscrepancy } from '../data/entities'
import type { InboxActionStatus, InboxActionType, InboxProposalStatus } from '../data/entities'
import { REQUIRED_FEATURES_MAP } from './constants'
import { formatZodErrors } from './validation'
import { ExecutionError, executeCommand } from './executionHelpers'

interface CommonEntityFields {
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  createdAt?: Date
}

export interface CrossModuleEntities {
  CustomerEntity: EntityClass<CommonEntityFields & { id: string; kind: string; displayName: string; primaryEmail?: string | null }>
  SalesOrder: EntityClass<CommonEntityFields & { id: string; orderNumber: string; currencyCode: string; comments?: string | null; customerReference?: string | null }>
  SalesShipment: EntityClass<CommonEntityFields & { id: string; order: unknown }>
  SalesChannel: EntityClass<CommonEntityFields & { id: string; name: string; currencyCode?: string; metadata?: Record<string, unknown> | null }>
  Dictionary: EntityClass<CommonEntityFields & { id: string; key: string }>
  DictionaryEntry: EntityClass<CommonEntityFields & { id: string; label: string; value: string; normalizedValue?: string | null; dictionary: unknown }>
}

interface ExecutionContext {
  em: EntityManager
  userId: string
  tenantId: string
  organizationId: string
  eventBus?: EventBus | null
  container: AwilixContainer
  auth?: AuthContext
  entities?: CrossModuleEntities
}

interface ExecutionResult {
  success: boolean
  createdEntityId?: string | null
  createdEntityType?: string | null
  error?: string
  statusCode?: number
}

interface TypeExecutionResult {
  createdEntityId?: string | null
  createdEntityType?: string | null
  matchedEntityId?: string | null
  matchedEntityType?: string | null
}

const ACTION_EXECUTABLE_STATUSES: InboxActionStatus[] = ['pending', 'failed']

export async function executeAction(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const em = ctx.em.fork()

  try {
    await ensureUserCanExecuteAction(action, ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to verify permissions'
    const statusCode = err instanceof ExecutionError ? err.statusCode : 503
    return { success: false, error: message, statusCode }
  }

  const claimed = await em.nativeUpdate(
    InboxProposalAction,
    {
      id: action.id,
      proposalId: action.proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      deletedAt: null,
    },
    {
      status: 'processing',
      executionError: null,
    },
  )

  if (claimed === 0) {
    return { success: false, error: 'Action already processed', statusCode: 409 }
  }

  const freshAction = await findOneWithDecryption(
    em,
    InboxProposalAction,
    { id: action.id, deletedAt: null },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!freshAction) {
    return { success: false, error: 'Action not found', statusCode: 404 }
  }

  try {
    const result = await executeByType(freshAction, ctx)

    freshAction.status = 'executed'
    freshAction.executedAt = new Date()
    freshAction.executedByUserId = ctx.userId
    freshAction.createdEntityId = result.createdEntityId || null
    freshAction.createdEntityType = result.createdEntityType || null
    if (result.matchedEntityId !== undefined) {
      freshAction.matchedEntityId = result.matchedEntityId
    }
    if (result.matchedEntityType !== undefined) {
      freshAction.matchedEntityType = result.matchedEntityType
    }
    freshAction.executionError = null

    await em.flush()
    const encScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await resolveActionDiscrepancies(em, freshAction.id, encScope)

    // After create_contact or link_contact, resolve unknown_contact discrepancies
    // on ALL other actions in the same proposal that reference the same email
    if (freshAction.actionType === 'create_contact' || freshAction.actionType === 'link_contact') {
      const payload = freshAction.payload as Record<string, unknown> | null
      const contactEmail =
        typeof payload?.email === 'string' ? payload.email
          : typeof payload?.emailAddress === 'string' ? payload.emailAddress
            : null
      if (contactEmail) {
        await resolveUnknownContactDiscrepanciesInProposal(
          em, freshAction.proposalId, contactEmail, encScope,
        )
      }
    }

    await recalculateProposalStatus(em, freshAction.proposalId, encScope)

    if (ctx.eventBus) {
      await ctx.eventBus.emit('inbox_ops.action.executed', {
        actionId: freshAction.id,
        proposalId: freshAction.proposalId,
        actionType: freshAction.actionType,
        createdEntityId: result.createdEntityId || null,
        createdEntityType: result.createdEntityType || null,
        executedByUserId: ctx.userId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    }

    return { success: true, ...result, statusCode: 200 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode = err instanceof ExecutionError ? err.statusCode : 500

    freshAction.status = 'failed'
    freshAction.executionError = message
    freshAction.executedAt = new Date()
    freshAction.executedByUserId = ctx.userId
    await em.flush()

    await recalculateProposalStatus(em, freshAction.proposalId, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })

    if (ctx.eventBus) {
      await ctx.eventBus.emit('inbox_ops.action.failed', {
        actionId: freshAction.id,
        proposalId: freshAction.proposalId,
        actionType: freshAction.actionType,
        error: freshAction.executionError,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    }

    return { success: false, error: freshAction.executionError || 'Unknown error', statusCode }
  }
}

export async function rejectAction(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<void> {
  const em = ctx.em.fork()
  const rejectedAt = new Date()
  const claimed = await em.nativeUpdate(
    InboxProposalAction,
    {
      id: action.id,
      proposalId: action.proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      deletedAt: null,
    },
    {
      status: 'rejected',
      executedAt: rejectedAt,
      executedByUserId: ctx.userId,
    },
  )
  if (claimed === 0) return

  const freshAction = await findOneWithDecryption(
    em,
    InboxProposalAction,
    { id: action.id, deletedAt: null },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!freshAction) return

  const encScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await resolveActionDiscrepancies(em, freshAction.id, encScope)
  await recalculateProposalStatus(em, freshAction.proposalId, encScope)

  if (ctx.eventBus) {
    await ctx.eventBus.emit('inbox_ops.action.rejected', {
      actionId: freshAction.id,
      proposalId: freshAction.proposalId,
      actionType: freshAction.actionType,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}

export async function rejectProposal(
  proposalId: string,
  ctx: ExecutionContext,
): Promise<void> {
  const em = ctx.em.fork()
  const rejectedAt = new Date()

  await em.nativeUpdate(
    InboxProposalAction,
    {
      proposalId,
      status: { $in: ACTION_EXECUTABLE_STATUSES },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    {
      status: 'rejected',
      executedAt: rejectedAt,
      executedByUserId: ctx.userId,
    },
  )

  await em.nativeUpdate(
    InboxDiscrepancy,
    {
      proposalId,
      resolved: false,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    },
    { resolved: true },
  )

  await recalculateProposalStatus(em, proposalId, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })

  if (ctx.eventBus) {
    await ctx.eventBus.emit('inbox_ops.proposal.rejected', {
      proposalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}

export async function acceptAllActions(
  proposalId: string,
  ctx: ExecutionContext,
): Promise<{ results: ExecutionResult[]; stoppedOnFailure: boolean }> {
  const em = ctx.em.fork()
  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    {
      proposalId,
      status: 'pending',
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'ASC' } },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  const results: ExecutionResult[] = []
  let stoppedOnFailure = false

  for (const action of actions) {
    const result = await executeAction(action, ctx)
    results.push(result)

    if (!result.success) {
      stoppedOnFailure = true
      break
    }
  }

  return { results, stoppedOnFailure }
}

/**
 * Normalize common LLM payload issues before action-specific normalization.
 */
function normalizeCommonPayloadFields(
  payload: Record<string, unknown>,
  actionType: string,
): Record<string, unknown> {
  // Lowercase contact type fields (LLM often outputs "Person" / "Company")
  if (typeof payload.type === 'string') {
    payload.type = payload.type.toLowerCase()
  }
  if (typeof payload.contactType === 'string') {
    payload.contactType = payload.contactType.toLowerCase()
  }

  // Normalize link_contact field names (LLM may use various alternatives)
  if (actionType === 'link_contact') {
    if (!payload.emailAddress) {
      const alt = payload.email ?? payload.contactEmail
      if (typeof alt === 'string') payload.emailAddress = alt
    }
    if (!payload.contactId) {
      const alt = payload.id ?? payload.matchedId ?? payload.matchedContactId
      if (typeof alt === 'string') payload.contactId = alt
    }
    if (!payload.contactType) {
      const alt = payload.type ?? payload.kind ?? payload.matchedType ?? payload.matchedContactType
      if (typeof alt === 'string') payload.contactType = alt.toLowerCase()
    }
    if (!payload.contactName) {
      const alt = payload.name ?? payload.displayName
      if (typeof alt === 'string') payload.contactName = alt
    }
  }

  return payload
}

/**
 * Adapt the internal ExecutionContext to the shared InboxActionExecutionContext
 * for use by registered action handlers.
 */
function adaptContext(ctx: ExecutionContext): InboxActionExecutionContext {
  return {
    ...ctx,
    executeCommand: <TInput, TResult>(commandId: string, input: TInput) =>
      executeCommand<TInput, TResult>(ctx, commandId, input),
    resolveEntityClass: <T>(key: string) =>
      resolveEntityClassInternal(ctx, key) as (new (...args: unknown[]) => T) | null,
  }
}

async function executeByType(
  action: InboxProposalAction,
  ctx: ExecutionContext,
): Promise<TypeExecutionResult> {
  // Lazy-load the generated registry to avoid circular imports at module load time
  const { getInboxAction } = await import('@/.mercato/generated/inbox-actions.generated')
  const definition = getInboxAction(action.actionType)
  if (!definition) {
    throw new ExecutionError(`Unknown action type: ${action.actionType}`, 400)
  }

  let payload = { ...(action.payload as Record<string, unknown>) }

  // Common normalization (lowercase enums, field aliases)
  payload = normalizeCommonPayloadFields(payload, action.actionType)

  // Action-specific normalization from the registered handler
  const actionCtx = adaptContext(ctx)
  if (definition.normalizePayload) {
    payload = await definition.normalizePayload(payload, actionCtx)
  }

  const parsed = definition.payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ExecutionError(
      `Invalid ${action.actionType} payload: ${formatZodErrors(parsed.error)}`,
      400,
    )
  }

  return definition.execute(
    { id: action.id, proposalId: action.proposalId, payload: parsed.data },
    actionCtx,
  )
}

async function resolveUnknownContactDiscrepanciesInProposal(
  em: EntityManager,
  proposalId: string,
  contactEmail: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  if (!contactEmail) return

  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    {
      proposalId,
      type: 'unknown_contact',
      resolved: false,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )

  const normalizedEmail = contactEmail.trim().toLowerCase()
  const matching = discrepancies.filter((d) => {
    const foundValue = (d.foundValue || '').trim().toLowerCase()
    return foundValue === normalizedEmail
  })

  for (const d of matching) {
    d.resolved = true
  }

  if (matching.length > 0) {
    await em.flush()
  }
}

async function ensureUserCanExecuteAction(action: InboxProposalAction, ctx: ExecutionContext): Promise<void> {
  const requiredFeature = getRequiredFeatureForAction(action)
  if (!requiredFeature) return

  const rbacService = ctx.container.resolve('rbacService') as {
    userHasAllFeatures: (
      userId: string,
      features: string[],
      scope: { tenantId: string; organizationId: string },
    ) => Promise<boolean>
  }

  if (!rbacService || typeof rbacService.userHasAllFeatures !== 'function') {
    throw new ExecutionError('Unable to verify permissions for action execution', 503)
  }

  const hasFeature = await rbacService.userHasAllFeatures(
    ctx.userId,
    [requiredFeature],
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!hasFeature) {
    throw new ExecutionError(`Insufficient permissions: ${requiredFeature} required`, 403)
  }
}

function resolveEntityClassInternal(
  ctx: ExecutionContext,
  key: string,
): unknown {
  const fromEntities = (ctx.entities as Record<string, unknown> | undefined)?.[key]
  if (fromEntities) return fromEntities
  try { return ctx.container.resolve(key) } catch { return null }
}

// Re-export splitPersonName for backward compat
export { splitPersonName } from './contactValidation'

async function resolveActionDiscrepancies(
  em: EntityManager,
  actionId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    { actionId, resolved: false },
    undefined,
    scope,
  )
  for (const discrepancy of discrepancies) {
    discrepancy.resolved = true
  }
  if (discrepancies.length > 0) {
    await em.flush()
  }
}

export async function recalculateProposalStatus(
  em: EntityManager,
  proposalId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const proposal = await findOneWithDecryption(
    em,
    InboxProposal,
    { id: proposalId, deletedAt: null },
    undefined,
    scope,
  )
  if (!proposal) return

  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    { proposalId, deletedAt: null },
    undefined,
    scope,
  )

  if (actions.length === 0) {
    proposal.status = 'pending'
    await em.flush()
    return
  }

  const statuses = actions.map((action) => action.status)
  const allAcceptedOrExecuted = statuses.every((status) => status === 'accepted' || status === 'executed')
  const allRejected = statuses.every((status) => status === 'rejected')
  const allPending = statuses.every((status) => status === 'pending')

  let newStatus: InboxProposalStatus
  if (allAcceptedOrExecuted) {
    newStatus = 'accepted'
  } else if (allRejected) {
    newStatus = 'rejected'
  } else if (allPending) {
    newStatus = 'pending'
  } else {
    newStatus = 'partial'
  }

  if (proposal.status !== newStatus) {
    proposal.status = newStatus
    await em.flush()
  }
}

export function getRequiredFeature(actionType: InboxActionType): string {
  return REQUIRED_FEATURES_MAP[actionType]
}

function getRequiredFeatureForAction(action: InboxProposalAction): string {
  if (action.actionType === 'create_contact') {
    const payload = action.payload as Record<string, unknown> | null
    if (payload?.type === 'company') {
      return 'customers.companies.manage'
    }
  }
  return REQUIRED_FEATURES_MAP[action.actionType]
}
