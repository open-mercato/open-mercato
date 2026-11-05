import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WebhookDeliveryEntity, WebhookEntity } from '../data/entities'
import { redactWebhookCustomHeaders, type WebhookCustomHeadersUpdate } from '../lib/custom-headers'

export type WebhookRequestScope = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
  tenantId: string
  organizationId: string | null
  allowedOrganizationIds: string[] | null
  auth?: AuthContext
}

export function json(payload: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

export async function resolveWebhookRequestScope(request: Request): Promise<WebhookRequestScope | Response> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const { translate } = await resolveTranslations()

  if (!auth) {
    return json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = scope?.tenantId ?? auth.tenantId ?? null
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth)
  const allowedOrganizationIds = Array.isArray(scope?.allowedIds) ? scope.allowedIds : null

  if (!tenantId) {
    return json({ error: translate('webhooks.errors.tenantRequired', 'Tenant context required') }, { status: 400 })
  }

  return {
    container,
    em: container.resolve('em') as EntityManager,
    tenantId,
    organizationId,
    allowedOrganizationIds,
    auth,
  }
}

export async function canRevealWebhookCredentialHeaders(
  container: WebhookRequestScope['container'],
  auth: AuthContext | undefined,
  webhook: Pick<WebhookEntity, 'tenantId' | 'organizationId'>,
): Promise<boolean> {
  if (!auth?.sub) return false
  const rbacService = container.resolve('rbacService') as RbacService
  return rbacService.userHasAllFeatures(auth.sub, ['webhooks.secrets'], {
    tenantId: webhook.tenantId,
    organizationId: webhook.organizationId,
  })
}

export async function findScopedWebhook(
  em: EntityManager,
  scope: Pick<WebhookRequestScope, 'tenantId' | 'organizationId' | 'allowedOrganizationIds'>,
  webhookId: string,
): Promise<WebhookEntity | null> {
  const webhook = await findOneWithDecryption(
    em,
    WebhookEntity,
    { id: webhookId, tenantId: scope.tenantId, deletedAt: null },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId ?? '' },
  )

  if (!webhook) return null
  if (scope.allowedOrganizationIds && scope.allowedOrganizationIds.length > 0 && !scope.allowedOrganizationIds.includes(webhook.organizationId)) {
    return null
  }
  if (!scope.allowedOrganizationIds && scope.organizationId && webhook.organizationId !== scope.organizationId) {
    return null
  }

  return webhook
}

export async function findScopedDelivery(
  em: EntityManager,
  scope: Pick<WebhookRequestScope, 'tenantId' | 'organizationId' | 'allowedOrganizationIds'>,
  deliveryId: string,
): Promise<WebhookDeliveryEntity | null> {
  const delivery = await em.findOne(WebhookDeliveryEntity, { id: deliveryId, tenantId: scope.tenantId })
  if (!delivery) return null

  if (scope.allowedOrganizationIds && scope.allowedOrganizationIds.length > 0 && !scope.allowedOrganizationIds.includes(delivery.organizationId)) {
    return null
  }
  if (!scope.allowedOrganizationIds && scope.organizationId && delivery.organizationId !== scope.organizationId) {
    return null
  }

  return delivery
}

export async function translateWebhookCustomHeadersRejection(
  rejection: Extract<WebhookCustomHeadersUpdate, { ok: false }>,
): Promise<string> {
  const { translate } = await resolveTranslations()
  if (rejection.reason === 'credentialHeadersRequireReentry') {
    return translate(
      'webhooks.errors.credentialHeadersRequireReentry',
      'Header "{header}" has a hidden value. Enter it again or remove it when you change the webhook URL.',
      { header: rejection.header },
    )
  }
  return translate(
    'webhooks.errors.redactedHeaderWithoutValue',
    'Header "{header}" has a hidden value but no saved value to keep. Enter the header value.',
    { header: rejection.header },
  )
}

export function serializeWebhookListItem(item: WebhookEntity) {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? null,
    url: item.url,
    subscribedEvents: item.subscribedEvents,
    httpMethod: item.httpMethod,
    isActive: item.isActive,
    deliveryStrategy: item.deliveryStrategy,
    maxRetries: item.maxRetries,
    consecutiveFailures: item.consecutiveFailures,
    lastSuccessAt: item.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: item.lastFailureAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

export function serializeWebhookDetail(
  item: WebhookEntity,
  options: { revealCredentialHeaders?: boolean } = {},
) {
  return {
    ...serializeWebhookListItem(item),
    customHeaders: options.revealCredentialHeaders
      ? item.customHeaders ?? null
      : redactWebhookCustomHeaders(item.customHeaders),
    strategyConfig: item.strategyConfig ?? null,
    timeoutMs: item.timeoutMs,
    rateLimitPerMinute: item.rateLimitPerMinute,
    autoDisableThreshold: item.autoDisableThreshold,
    integrationId: item.integrationId ?? null,
    maskedSecret: maskSecret(item.secret),
    previousSecretSetAt: item.previousSecretSetAt?.toISOString() ?? null,
  }
}

export function serializeDeliveryListItem(
  item: WebhookDeliveryEntity,
  options: { webhookName?: string | null } = {},
) {
  return {
    id: item.id,
    webhookId: item.webhookId,
    webhookName: options.webhookName ?? null,
    eventType: item.eventType,
    messageId: item.messageId,
    status: item.status,
    responseStatus: item.responseStatus ?? null,
    errorMessage: item.errorMessage ?? null,
    attemptNumber: item.attemptNumber,
    maxAttempts: item.maxAttempts,
    targetUrl: item.targetUrl,
    durationMs: item.durationMs ?? null,
    enqueuedAt: item.enqueuedAt.toISOString(),
    lastAttemptAt: item.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: item.deliveredAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  }
}

export function serializeDeliveryDetail(item: WebhookDeliveryEntity) {
  return {
    ...serializeDeliveryListItem(item),
    payload: item.payload,
    responseBody: item.responseBody ?? null,
    responseHeaders: item.responseHeaders ?? null,
    nextRetryAt: item.nextRetryAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  }
}

function maskSecret(secret: string): string {
  if (!secret) return '••••••••'
  return `${secret.slice(0, 6)}••••••••`
}
