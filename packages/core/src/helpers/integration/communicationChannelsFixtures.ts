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
  input: {
    displayName?: string;
    externalIdentifier?: string;
    /**
     * `chat` connects the non-email stub instead: a channel whose senders carry
     * an opaque handle and no address, and whose `externalIdentifier` is NULL —
     * the shape a real Discord/Slack channel has. Use it for anything asserting
     * the hub's sender-identity contract (#4975); the default `email` flavor
     * cannot prove it, because it can only ever supply email-shaped data.
     */
    providerFlavor?: 'email' | 'chat';
    /**
     * Relabel the connected stub channel's `provider_key`. Provider packages own
     * routes that filter on their own key, and a real channel for those providers
     * cannot be connected in CI (the Discord adapter validates its bot token
     * against the live API), so without this a provider-scoped listing can only
     * be asserted against an empty result — the assertion that stayed green
     * through #5602.
     *
     * The row is relabelled, nothing is registered: do not drive an outbound send
     * through a relabelled channel, because delivery would resolve the real
     * provider's adapter.
     */
    labelAsProviderKey?: string;
  } = {},
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
/**
 * Ingest an inbound chat message through the REAL `ingest_inbound_message`
 * command: the stub adapter normalizes the frame and the hub composes the
 * platform message via `messages.messages.compose`.
 *
 * Unlike {@link seedInboundMessage}, nothing here is short-circuited — no row is
 * inserted behind the compose path — so a hub contract the provider cannot
 * satisfy fails the test instead of hiding behind seeded data. That bypass is
 * exactly why CI was green while every real inbound Discord message was rejected
 * (#4975).
 *
 * The sender is identified only by `senderIdentifier` (a Discord snowflake, a
 * Slack member id, …). There is deliberately no way to pass an address.
 */
export async function ingestInboundChatMessage(
  request: APIRequestContext,
  token: string,
  input: {
    channelId: string;
    senderIdentifier: string;
    senderDisplayName?: string;
    body?: string;
    externalMessageId: string;
    externalConversationId: string;
  },
): Promise<{
  status: string;
  messageId: string | null;
  conversationId: string | null;
  channelLinkId: string | null;
  channelType: string | null;
}> {
  const response = await apiRequest(request, 'POST', TEST_SEED_PATH, {
    token,
    data: { action: 'ingest-inbound', ...input },
  });
  expect(
    response.status(),
    'POST /api/communication_channels/test-seed (ingest-inbound) should return 201 — ' +
      'a non-201 here means the hub rejected a sender with no email address',
  ).toBe(201);
  const body = await readJsonSafe<{
    status?: string;
    messageId?: string | null;
    conversationId?: string | null;
    channelLinkId?: string | null;
    channelType?: string | null;
  }>(response);
  return {
    status: body?.status ?? 'unknown',
    messageId: body?.messageId ?? null,
    conversationId: body?.conversationId ?? null,
    channelLinkId: body?.channelLinkId ?? null,
    channelType: body?.channelType ?? null,
  };
}

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
