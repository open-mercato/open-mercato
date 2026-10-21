import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('financial')

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type PostingSubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

type SalesPostingKind = 'sales_invoice' | 'sales_payment'
type SalesPostingOperation = 'upsert' | 'reverse'

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function resolveContainer(ctx: PostingSubscriberContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

/**
 * The glue between a sales CRUD event and the posting command.
 *
 * The sales event carries only identifiers; the command reads the document and
 * decides. A 4xx is a configuration or data gap that a retry cannot fix — the
 * event bus's persistent subscription would retry it forever — so those are
 * logged and swallowed, while a 5xx or an unknown failure is rethrown and retried.
 */
export async function handleSalesDocumentPosting(
  kind: SalesPostingKind,
  operation: SalesPostingOperation,
  payload: unknown,
  ctx: PostingSubscriberContext,
): Promise<void> {
  const record = toRecord(payload)
  const sourceEntityId = readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  if (!sourceEntityId || !tenantId || !organizationId) {
    logger.warn('financial.sales_posting.skipped_context', { kind, operation, payload })
    return
  }

  const container = resolveContainer(ctx)
  const commandBus = container.resolve<CommandBus>('commandBus')
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }

  try {
    await commandBus.execute('financial.sales_document.post', {
      input: {
        tenantId,
        organizationId,
        sourceEntityType: kind,
        sourceEntityId,
        operation,
      },
      ctx: commandCtx,
    })
  } catch (err) {
    logger.error('financial.sales_posting.failed', { err, kind, operation, sourceEntityId })
    if (isCrudHttpError(err) && err.status < 500) return
    throw err
  }
}
