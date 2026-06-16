import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

/**
 * Communication-channels integration fixtures.
 *
 * These drive the TEST-ONLY seed endpoint `POST /api/communication_channels/test-seed`,
 * which is gated by `OM_ENABLE_TEST_CHANNEL_SEEDING` (inert/404 in production). Use
 * {@link isChannelSeedingAvailable} to skip tests when the gate is off rather than
 * failing them.
 */

export type SeedAddressField =
  | string
  | { address: string; name?: string }
  | Array<string | { address: string; name?: string }>;

export type CapturedTestSeedEmail = {
  capturedAt: string;
  externalMessageId: string;
  conversationId?: string;
  content: {
    text?: string;
    html?: string;
    bodyFormat?: 'text' | 'markdown' | 'html';
    attachments?: Array<{ url: string; mimeType: string; fileName: string; fileSize?: number; inline?: boolean }>;
    raw?: Record<string, unknown>;
  };
  credentials: Record<string, unknown>;
  scope: {
    tenantId: string;
    organizationId: string;
  };
  metadata?: Record<string, unknown>;
};

const TEST_SEED_PATH = '/api/communication_channels/test-seed';

/**
 * Probe whether the env-gated test-seed endpoint is enabled in the target app.
 * Returns false when the route answers 404 (flag off) so callers can `test.skip`.
 * The caller's token must hold `communication_channels.connect_user_channel`.
 */
export async function isChannelSeedingAvailable(
  request: APIRequestContext,
  token: string,
): Promise<boolean> {
  // A malformed body returns 422 when the gate is ON and 404 when it is OFF.
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: '__probe__' },
  });
  return response.status() !== 404;
}

/**
 * Seed a connected, network-free `__test_seed__` channel owned by the caller.
 * Returns the new channel id. Tear down with {@link deleteChannelIfExists}.
 */
export async function seedConnectedChannel(
  request: APIRequestContext,
  token: string,
  input: { displayName?: string; externalIdentifier?: string } = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'connect-channel', ...input },
  });
  expect(
    response.status(),
    'POST /api/communication_channels/test-seed (connect-channel) should return 201',
  ).toBe(201);
  const body = await readJsonSafe<{ channelId?: string }>(response);
  return expectId(body?.channelId, 'connect-channel response should include channelId');
}

export async function seedSystemEmailChannel(
  request: APIRequestContext,
  token: string,
  input: { displayName?: string; externalIdentifier?: string } = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'seed-system-channel', ...input },
  });
  expect(
    response.status(),
    'POST /api/communication_channels/test-seed (seed-system-channel) should return 201',
  ).toBe(201);
  const body = await readJsonSafe<{ channelId?: string }>(response);
  return expectId(body?.channelId, 'seed-system-channel response should include channelId');
}

export async function clearCapturedSystemEmails(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'clear-capture' },
  });
  expect(response.ok(), 'POST /api/communication_channels/test-seed (clear-capture) should succeed').toBeTruthy();
}

export async function listCapturedSystemEmails(
  request: APIRequestContext,
  token: string,
): Promise<CapturedTestSeedEmail[]> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'list-capture' },
  });
  expect(response.ok(), 'POST /api/communication_channels/test-seed (list-capture) should succeed').toBeTruthy();
  const body = await readJsonSafe<{ items?: CapturedTestSeedEmail[] }>(response);
  return Array.isArray(body?.items) ? body.items : [];
}

export async function waitForCapturedSystemEmail(
  request: APIRequestContext,
  token: string,
  predicate: (email: CapturedTestSeedEmail) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<CapturedTestSeedEmail> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastItems: CapturedTestSeedEmail[] = [];
  while (Date.now() < deadline) {
    lastItems = await listCapturedSystemEmails(request, token);
    const found = lastItems.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const summary = lastItems.map((item) => ({
    to: item.metadata?.to,
    from: item.metadata?.from,
    subject: item.metadata?.subject,
    scope: item.scope,
    bodyFormat: item.content?.bodyFormat,
  }));
  throw new Error(
    `Timed out waiting for captured system email${options.description ? `: ${options.description}` : ''}. Captured ${lastItems.length} message(s): ${JSON.stringify(summary)}`,
  );
}

/**
 * Seed an inbound `MessageChannelLink` for `channelId` and emit
 * `communication_channels.message.received` through the real event bus. The
 * persistent customers link-channel-message-received subscriber is enqueued to
 * the `events` queue — drain it with `drainIntegrationQueue('events')`.
 *
 * Returns the created link + message ids (the message id is the platform
 * `messages.message` id, usable as `messageThreadId` to thread a follow-up).
 *
 * Pass `createThreadMapping: true` to also seed a `ChannelThreadMapping` for the
 * thread — required before exercising the reaction (`/messages/[id]/reactions`)
 * and thread-assign (`/threads/[id]/assign`) routes, which resolve the owning
 * channel through that mapping.
 */
export async function seedInboundMessage(
  request: APIRequestContext,
  token: string,
  input: {
    channelId: string;
    from?: SeedAddressField;
    to?: SeedAddressField;
    cc?: SeedAddressField;
    subject?: string;
    bodyText?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
    messageThreadId?: string;
    providerKey?: string;
    createThreadMapping?: boolean;
  },
): Promise<{ channelLinkId: string; messageId: string; conversationId: string }> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'emit-inbound', ...input },
  });
  expect(
    response.status(),
    'POST /api/communication_channels/test-seed (emit-inbound) should return 201',
  ).toBe(201);
  const body = await readJsonSafe<{
    channelLinkId?: string;
    messageId?: string;
    conversationId?: string;
  }>(response);
  return {
    channelLinkId: expectId(body?.channelLinkId, 'emit-inbound response should include channelLinkId'),
    messageId: expectId(body?.messageId, 'emit-inbound response should include messageId'),
    conversationId: expectId(
      body?.conversationId,
      'emit-inbound response should include conversationId',
    ),
  };
}

/**
 * Best-effort delete of a seeded channel via the owner-scoped DELETE route.
 * Safe to call with a null id in `finally`.
 */
export async function deleteChannelIfExists(
  request: APIRequestContext,
  token: string | null,
  channelId: string | null,
): Promise<void> {
  if (!token || !channelId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/communication_channels/channels/${encodeURIComponent(channelId)}`,
    { token },
  ).catch(() => undefined);
}
