import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createOrGetClaimFromInboundMessage } from '../lib/emailIntake'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

// Chosen over `communication_channels.message.received`: that hub event currently
// carries only message/channel ids, while `inbox_ops.email.received` includes the
// sender address required to create an unlinked warranty claim contact snapshot.
export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'warranty_claims:email-to-claim',
}

const MODULE_ID = 'warranty_claims'
const EMAIL_INTAKE_ENABLED_KEY = 'emailIntakeEnabled'
const EMAIL_INTAKE_ENV = 'OM_WARRANTY_EMAIL_INTAKE'

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = Resolver & {
  container?: Resolver
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(record, key)
    if (value) return value
  }
  return null
}

function readNestedString(record: Record<string, unknown>, parentKey: string, childKey: string): string | null {
  const child = toRecord(record[parentKey])
  return readString(child, childKey)
}

function resolveContainer(ctx: SubscriberContext): AwilixContainer {
  return (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
}

function tryResolve<T>(ctx: SubscriberContext, name: string): T | undefined {
  try {
    return resolveContainer(ctx).resolve<T>(name)
  } catch {
    return undefined
  }
}

function parseConfigBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return parseBooleanWithDefault(value ? 'true' : 'false', false)
  if (typeof value === 'string') return parseBooleanWithDefault(value, false)
  return false
}

async function isEmailIntakeEnabled(
  ctx: SubscriberContext,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const moduleConfig = tryResolve<ModuleConfigService>(ctx, 'moduleConfigService')
  if (!moduleConfig) {
    return parseBooleanWithDefault(process.env[EMAIL_INTAKE_ENV], false)
  }

  try {
    const value = await moduleConfig.getValue<unknown>(MODULE_ID, EMAIL_INTAKE_ENABLED_KEY, {
      defaultValue: null,
      scope,
    })
    return parseConfigBoolean(value)
  } catch {
    return false
  }
}

function readMessageRef(record: Record<string, unknown>): string | null {
  return readFirstString(record, [
    'intakeMessageRef',
    'messageId',
    'emailId',
    'externalMessageId',
    'id',
  ])
}

function readContactEmail(record: Record<string, unknown>): string | null {
  return readFirstString(record, [
    'contactEmail',
    'contact_email',
    'forwardedByAddress',
    'senderEmail',
    'senderIdentifier',
    'fromEmail',
    'fromAddress',
  ])
    ?? readNestedString(record, 'from', 'email')
    ?? readNestedString(record, 'sender', 'email')
}

function readSenderName(record: Record<string, unknown>): string | null {
  return readFirstString(record, [
    'customerName',
    'contactName',
    'forwardedByName',
    'senderName',
    'senderDisplayName',
    'fromName',
  ])
    ?? readNestedString(record, 'from', 'name')
    ?? readNestedString(record, 'sender', 'name')
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const tenantId = readString(record, 'tenantId') ?? readString(record, 'tenant_id') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId')
    ?? readString(record, 'organization_id')
    ?? readString(record, 'orgId')
    ?? ctx.organizationId
    ?? null

  if (!tenantId || !organizationId) {
    logger.warn('[warranty_claims:email-to-claim] skipped inbound email payload', {
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  // Tenant enables warranty email intake deliberately once a dedicated warranty inbox is routed.
  if (!(await isEmailIntakeEnabled(ctx, { tenantId, organizationId }))) return

  const intakeMessageRef = readMessageRef(record)
  const contactEmail = readContactEmail(record)

  if (!intakeMessageRef || !contactEmail) {
    logger.warn('[warranty_claims:email-to-claim] skipped inbound email payload', {
      hasTenantId: true,
      hasOrganizationId: true,
      hasIntakeMessageRef: Boolean(intakeMessageRef),
      hasContactEmail: Boolean(contactEmail),
    })
    return
  }

  try {
    const container = resolveContainer(ctx)
    const em = container.resolve<EntityManager>('em').fork()
    await createOrGetClaimFromInboundMessage({
      em,
      container,
      scope: { tenantId, organizationId },
      contactEmail,
      customerName: readSenderName(record),
      subject: readFirstString(record, ['subject', 'title']),
      body: readFirstString(record, ['body', 'bodyText', 'text', 'cleanedText', 'rawText']),
      intakeMessageRef,
    })
  } catch (err) {
    logger.warn('[warranty_claims:email-to-claim] failed to create warranty claim from inbound email', { err })
  }
}
