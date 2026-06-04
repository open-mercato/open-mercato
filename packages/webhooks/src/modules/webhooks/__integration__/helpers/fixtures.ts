import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb, setUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

export type WebhookCreateResponse = {
  id: string;
  name: string;
  url: string;
  secret: string;
  subscribedEvents: string[];
  isActive: boolean;
};

export type WebhookDetailResponse = {
  id: string;
  name: string;
  description: string | null;
  url: string;
  subscribedEvents: string[];
  httpMethod: 'POST' | 'PUT' | 'PATCH';
  isActive: boolean;
  deliveryStrategy: string;
  maxRetries: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
  customHeaders: Record<string, string> | null;
  strategyConfig: Record<string, unknown> | null;
  timeoutMs: number;
  rateLimitPerMinute: number;
  autoDisableThreshold: number;
  integrationId: string | null;
  maskedSecret: string;
  previousSecretSetAt: string | null;
};

export type WebhookDeliveryDetailResponse = {
  id: string;
  webhookId: string;
  eventType: string;
  messageId: string;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  attemptNumber: number;
  maxAttempts: number;
  targetUrl: string;
  durationMs: number | null;
  enqueuedAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  responseBody: string | null;
  responseHeaders: Record<string, string> | null;
  nextRetryAt: string | null;
  updatedAt: string;
};

type DeliveryListResponse = {
  items: Array<{
    id: string;
    webhookId: string;
    webhookName: string | null;
    eventType: string;
    messageId: string;
    status: string;
    responseStatus: number | null;
    errorMessage: string | null;
    attemptNumber: number;
    maxAttempts: number;
    targetUrl: string;
    durationMs: number | null;
    enqueuedAt: string;
    lastAttemptAt: string | null;
    deliveredAt: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type EventsResponse = {
  data: Array<{
    id: string;
    label: string;
    module?: string;
    category?: string;
    description?: string;
  }>;
  total: number;
};

export function buildMockInboundUrl(endpointId = 'mock_inbound'): string {
  return `${BASE_URL}/api/webhooks/inbound/${endpointId}`;
}

export async function createWebhookFixture(
  request: APIRequestContext,
  token: string,
  overrides: Partial<{
    name: string;
    description: string | null;
    url: string;
    subscribedEvents: string[];
    httpMethod: 'POST' | 'PUT' | 'PATCH';
    maxRetries: number;
    timeoutMs: number;
    rateLimitPerMinute: number;
    autoDisableThreshold: number;
    customHeaders: Record<string, string> | null;
  }> = {},
): Promise<WebhookCreateResponse> {
  const response = await apiRequest(request, 'POST', '/api/webhooks', {
    token,
    data: {
      name: overrides.name ?? `Webhook ${Date.now()}`,
      description: overrides.description ?? 'Integration test webhook',
      url: overrides.url ?? buildMockInboundUrl(),
      subscribedEvents: overrides.subscribedEvents ?? ['catalog.product.created'],
      httpMethod: overrides.httpMethod ?? 'POST',
      maxRetries: overrides.maxRetries ?? 3,
      timeoutMs: overrides.timeoutMs ?? 5_000,
      rateLimitPerMinute: overrides.rateLimitPerMinute ?? 0,
      autoDisableThreshold: overrides.autoDisableThreshold ?? 5,
      customHeaders: overrides.customHeaders ?? null,
    },
  });

  expect(response.status()).toBe(201);
  const body = await readJsonSafe<WebhookCreateResponse>(response);
  if (!body) {
    throw new Error('Expected webhook create response body');
  }

  expectId(body.id, 'Expected webhook id');
  expect(typeof body.secret).toBe('string');
  expect(body.secret.startsWith('whsec_')).toBe(true);

  return body;
}

export async function getWebhookDetail(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  path = `/api/webhooks/${webhookId}`,
): Promise<WebhookDetailResponse> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<WebhookDetailResponse>(response);
  if (!body) {
    throw new Error(`Expected webhook detail response for ${webhookId}`);
  }
  return body;
}

export async function listWebhooks(
  request: APIRequestContext,
  token: string,
  path = '/api/webhooks',
): Promise<{ items: Array<{ id: string; name: string; url: string }>; total: number }> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<{ items: Array<{ id: string; name: string; url: string }>; total: number }>(response);
  if (!body) {
    throw new Error('Expected webhook list response');
  }
  return body;
}

export async function listWebhookEvents(request: APIRequestContext, token: string): Promise<EventsResponse> {
  const response = await apiRequest(request, 'GET', '/api/webhooks/events', { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<EventsResponse>(response);
  if (!body) {
    throw new Error('Expected webhook events response');
  }
  return body;
}

export async function getDeliveryDetail(
  request: APIRequestContext,
  token: string,
  deliveryId: string,
  path = `/api/webhooks/deliveries/${deliveryId}`,
): Promise<WebhookDeliveryDetailResponse> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<WebhookDeliveryDetailResponse>(response);
  if (!body) {
    throw new Error(`Expected webhook delivery detail for ${deliveryId}`);
  }
  return body;
}

export async function listWebhookDeliveries(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  path = `/api/webhooks/deliveries?webhookId=${encodeURIComponent(webhookId)}`,
): Promise<DeliveryListResponse> {
  const response = await apiRequest(request, 'GET', path, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<DeliveryListResponse>(response);
  if (!body) {
    throw new Error(`Expected webhook deliveries for ${webhookId}`);
  }
  return body;
}

export async function waitForDeliveryStatus(
  request: APIRequestContext,
  token: string,
  deliveryId: string,
  expectedStatus: string,
): Promise<WebhookDeliveryDetailResponse> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = await getDeliveryDetail(request, token, deliveryId);
    if (detail.status === expectedStatus) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for delivery ${deliveryId} to reach status ${expectedStatus}`);
}

export async function deleteWebhookIfExists(
  request: APIRequestContext,
  token: string | null,
  webhookId: string | null,
): Promise<void> {
  if (!token || !webhookId) {
    return;
  }

  try {
    await apiRequest(request, 'DELETE', `/api/webhooks/${webhookId}`, { token });
  } catch {
    return;
  }
}

export type WebhookRotateSecretResponse = {
  success: true;
  secret: string;
  previousSecretSetAt: string | null;
};

export async function rotateWebhookSecret(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  path = `/api/webhooks/${webhookId}/rotate-secret`,
): Promise<WebhookRotateSecretResponse> {
  const response = await apiRequest(request, 'POST', path, { token });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<WebhookRotateSecretResponse>(response);
  if (!body) {
    throw new Error(`Expected rotate-secret response for ${webhookId}`);
  }
  return body;
}

export type WebhookTestDeliveryResponse = {
  success: true;
  delivery: WebhookDeliveryDetailResponse;
};

export async function sendTestDelivery(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  input: { eventType?: string; payload?: Record<string, unknown> } = {},
  path = `/api/webhooks/${webhookId}/test`,
): Promise<WebhookTestDeliveryResponse> {
  const response = await apiRequest(request, 'POST', path, { token, data: input });
  expect(response.status()).toBe(200);
  const body = await readJsonSafe<WebhookTestDeliveryResponse>(response);
  if (!body) {
    throw new Error(`Expected test delivery response for ${webhookId}`);
  }
  return body;
}

export type ProvisionedWebhooksUser = {
  userId: string;
  email: string;
  password: string;
  token: string;
};

/**
 * Creates a self-contained, role-less user and grants it an exact webhooks feature
 * set (and optional organization-visibility list) through a per-user ACL row, then
 * logs it in. The DB ACL path mirrors the org-scope fixtures: granting features via
 * the ACL API requires a super-admin actor, while `setUserAclInDb` keeps the spec
 * self-contained and deterministic. Login happens AFTER the ACL is written so the
 * fresh session resolves the new grants.
 */
export async function provisionWebhooksUser(
  request: APIRequestContext,
  adminToken: string,
  input: {
    tenantId: string;
    organizationId: string;
    features: string[];
    organizations?: string[] | null;
    slug: string;
  },
): Promise<ProvisionedWebhooksUser> {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const email = `qa-webhooks-${input.slug}-${unique}@acme.com`;
  const password = 'Valid1!Webhooks';
  const userId = await createUserFixture(request, adminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [],
    name: `QA Webhooks ${input.slug}`,
  });
  await setUserAclInDb({
    userId,
    tenantId: input.tenantId,
    features: input.features,
    organizations: input.organizations ?? null,
  });
  const token = await getAuthToken(request, email, password);
  return { userId, email, password, token };
}

export async function cleanupWebhooksUser(
  request: APIRequestContext,
  adminToken: string | null,
  user: ProvisionedWebhooksUser | null,
): Promise<void> {
  if (!user) return;
  await deleteUserAclInDb(user.userId).catch(() => undefined);
  await deleteUserIfExists(request, adminToken, user.userId).catch(() => undefined);
}
