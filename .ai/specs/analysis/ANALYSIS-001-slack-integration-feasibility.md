# ANALYSIS-001 — Slack Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Reference Spec** | SPEC-045 (Integration Marketplace & Connector Framework) |
| **Subject** | Can Open Mercato fully integrate with Slack using the SPEC-045 framework? |
| **Verdict** | **Partially — core notifications and OAuth work out-of-the-box; interactive features (slash commands, modals, app home, shortcuts) require new hub-level contracts or a dedicated Slack-specific module** |

---

## Executive Summary

The SPEC-045 integration framework provides strong foundation pieces for a Slack integration: OAuth 2.0 with PKCE, encrypted credential storage, operation logging, the integration registry, and widget injection. A basic "send notifications to Slack channels" integration is straightforward to build using the existing `notification_providers` hub.

However, Slack is not a simple notification transport. It is a **bidirectional collaboration platform** with slash commands, interactive modals, app home tabs, message shortcuts, event subscriptions, and rich Block Kit UI — none of which map to any existing hub adapter contract. A full-featured Slack integration requires either (a) significant extensions to the `communication_channels` and `notification_providers` hubs, or (b) a dedicated `channel_slack` module that bypasses hub contracts for Slack-specific features.

This document categorizes every Slack capability into one of four buckets:

| Bucket | Meaning |
|--------|---------|
| **Ready** | Fully supported by SPEC-045 today |
| **Straightforward** | Achievable with minor, non-breaking additions |
| **Requires Design** | Needs new contracts, entities, or patterns |
| **Difficult / Out of Scope** | Requires fundamental framework changes or is impractical |

---

## 1. Authentication & Credentials — Ready

### What Slack Needs

- OAuth 2.0 V2 flow (`https://slack.com/oauth/v2/authorize` + `oauth.v2.access`)
- Bot token (`xoxb-`) and optionally user token (`xoxp-`)
- Per-tenant OAuth app (Client ID + Client Secret entered by admin)
- Scopes: `chat:write`, `channels:read`, `users:read`, `commands`, etc.
- Token does **not** expire (Slack bot tokens are long-lived) — no refresh needed

### Framework Fit

| Requirement | SPEC-045 Coverage | Notes |
|-------------|-------------------|-------|
| OAuth 2.0 authorization code flow | SPEC-045a §8 | Direct match — `type: 'oauth'` credential field |
| Per-tenant OAuth app | SPEC-045a §8.2 | Admin brings own Client ID/Secret |
| Encrypted token storage | SPEC-045a §2 | `IntegrationCredentials` entity |
| Token refresh worker | SPEC-045a §8.5 | Not needed — Slack bot tokens don't expire |
| Re-auth detection | SPEC-045a §8.6 | Useful if admin revokes the app from Slack |

### Assessment: Ready

The existing OAuth infrastructure handles Slack's auth flow directly. One minor adaptation: Slack's token endpoint returns `authed_user.access_token` alongside the bot token. The OAuth callback handler would need to extract and store both tokens from the non-standard response shape, but this is a mapping concern, not an architectural gap.

**Credential field declaration (ready to use):**

```typescript
credentials: {
  fields: [
    { key: 'clientId', label: 'Slack App Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Slack App Client Secret', type: 'secret', required: true },
    {
      key: 'oauthTokens',
      label: 'Slack Workspace',
      type: 'oauth',
      required: true,
      oauth: {
        provider: 'slack',
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: ['chat:write', 'channels:read', 'users:read', 'commands'],
        usePkce: false, // Slack doesn't support PKCE
        refreshStrategy: 'background', // Token doesn't expire, but monitor revocation
      },
    },
  ],
}
```

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Non-standard token response | Low | Slack returns `authed_user` object alongside bot token. `OAuthTokenSet` may need a `rawResponse` field (already spec'd) to preserve both. |
| No PKCE support | None | Slack doesn't support PKCE. The framework makes it optional (`usePkce?: boolean`). |
| Dual token storage | Low | Need to store both `xoxb-` (bot) and optionally `xoxp-` (user) tokens. The `rawResponse` field in `OAuthTokenSet` can hold this. |

---

## 2. Outbound Notifications — Straightforward

### What Slack Needs

- Post messages to channels via `chat.postMessage`
- Support Block Kit JSON for rich formatting (order summaries, alerts with action buttons)
- Thread replies for grouped notifications
- Channel selection per notification type (orders to `#orders`, alerts to `#alerts`)
- Rate limiting: 1 message per second per channel, tier-based for other methods

### Framework Fit

| Requirement | SPEC-045 Coverage | Notes |
|-------------|-------------------|-------|
| Send notification via external transport | SPEC-045d §2 — `NotificationTransportAdapter` | `send()` method maps to `chat.postMessage` |
| Rich content formatting | `SendNotificationInput.htmlBody` | Partially — designed for email HTML, not Block Kit JSON |
| Channel routing | Not in adapter contract | Need to add channel selection to Slack-specific config |
| Rate limiting (outbound) | Not in framework | Framework has no outbound rate limiter |

### Assessment: Straightforward (with caveats)

A `notifier_slack` module can implement `NotificationTransportAdapter.send()` to call Slack's `chat.postMessage`. The basic contract works. However:

**What works immediately:**
- Platform events (order created, payment received, stock low) trigger notification subscribers
- Subscriber dispatches via the Slack transport adapter
- Operation logs capture success/failure
- Enable/disable per tenant

**What needs addition:**

1. **Block Kit template engine** — The `NotificationTransportAdapter.send()` receives `body: string` and `htmlBody?: string`. Slack needs `blocks: Block[]` (JSON). The Slack adapter must convert notification content to Block Kit format. This is adapter-internal logic, not a framework gap.

2. **Channel routing configuration** — Which Slack channel receives which notification type. Needs a widget injection on the integration detail page: a mapping UI (notification type → channel ID). This uses SPEC-045a §9 (widget injection) — the pattern exists.

3. **Outbound rate limiting** — Slack enforces 1 message/sec/channel. The adapter should queue messages through `packages/queue` with controlled concurrency. The queue infrastructure exists but the pattern isn't documented for outbound rate limiting.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Block Kit template system | Medium | Need to convert i18n-based notifications (`titleKey`/`bodyKey`) to Slack Block Kit JSON. Must build a Slack-specific renderer — not a framework gap but significant implementation effort. |
| Channel routing config | Medium | Need a per-tenant mapping of notification types to Slack channel IDs. Requires a new entity (`SlackChannelMapping`) and a config widget. Framework supports this via widget injection. |
| Outbound rate limiting | Medium | No framework pattern for throttling outbound API calls. Need queue-based sending with 1 msg/sec/channel concurrency control. |
| Thread grouping | Low | Grouping related notifications into Slack threads (e.g., all updates for order #1234 in one thread). Need to store `thread_ts` per entity. |
| Channel list API | Low | The config widget needs to list available Slack channels via `conversations.list`. Need to call Slack API from the widget's backend. |

---

## 3. Inbound Events (Slack Events API) — Requires Design

### What Slack Needs

- Public HTTPS endpoint to receive event payloads from Slack
- URL verification challenge (echo `challenge` parameter on initial setup)
- 3-second response time (acknowledge immediately, process async)
- Event deduplication (Slack retries on timeout)
- Signature verification (`X-Slack-Signature` + `X-Slack-Request-Timestamp`)
- Event types: `message.channels`, `app_mention`, `reaction_added`, `member_joined_channel`, etc.

### Framework Fit

| Requirement | SPEC-045 Coverage | Notes |
|-------------|-------------------|-------|
| Webhook endpoint | SPEC-045e (webhook_endpoints hub) | Generic webhook infrastructure exists |
| Signature verification | inbox_ops pattern (HMAC) | Pattern exists but Slack uses its own signing scheme |
| Async processing | `packages/queue` + workers | Queue + worker pattern fully supported |
| Event deduplication | inbox_ops (contentHash/messageId) | Pattern exists, needs adaptation for Slack event IDs |

### Assessment: Requires Design

The framework's webhook infrastructure handles generic inbound webhooks, but Slack's Events API has specific requirements that don't fit any existing hub adapter contract:

**Missing contracts/patterns:**

1. **URL Verification Challenge** — Slack sends a one-time `url_verification` event during app setup. The endpoint must return `{ challenge: <value> }`. No existing pattern handles this — it's a one-off setup handshake, not a recurring webhook.

2. **Event Router** — Slack sends many event types to a single URL. The framework needs to route `message.channels` differently from `reaction_added` or `app_mention`. The `ChannelAdapter.verifyWebhook()` from SPEC-045d returns a single `InboundMessage` — too narrow for the variety of Slack events.

3. **3-Second Response Constraint** — The endpoint must acknowledge within 3 seconds. Processing must be deferred to a worker queue. This pattern (acknowledge + queue) is standard but not formalized in the framework.

4. **Slack Signing Secret** — Slack uses HMAC-SHA256 with a signing secret (not the bot token). The signing secret must be stored separately in credentials.

5. **Socket Mode Alternative** — For on-premise deployments behind firewalls, Slack offers Socket Mode (WebSocket-based). The framework has no WebSocket client infrastructure. This is a fundamentally different delivery model that would require new patterns.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Event dispatcher pattern | High | No framework pattern for routing multiple event types from a single inbound URL to different handlers. Need an event type → handler mapping. |
| URL verification challenge | Medium | One-time setup handshake not covered by any existing webhook pattern. Simple to implement but needs to be documented. |
| Socket Mode support | High | WebSocket-based event delivery for behind-firewall deployments. Framework has zero WebSocket client infrastructure. Would need a persistent connection manager, reconnection logic, and acknowledgment protocol. |
| Slack-specific signature verification | Low | Different signing scheme from the generic HMAC pattern. Adapter-level concern. |

---

## 4. Slash Commands — Requires Design

### What Slack Needs

- HTTPS endpoint to receive command payloads (POST with form-encoded body)
- 3-second response constraint (immediate response or deferred via `response_url`)
- `trigger_id` for opening modals (valid for 3 seconds)
- Response types: `in_channel` (visible to all) or `ephemeral` (visible to invoking user only)
- Support Block Kit in responses

### Framework Fit

No existing hub contract covers slash commands. The `ChannelAdapter` contract is about messaging (send/receive messages), not command handling.

### Assessment: Requires Design

Slash commands are a unique interaction pattern with no framework equivalent:

1. **Command Registration** — Commands are configured in the Slack app manifest, not in Open Mercato. The platform needs to know which commands are registered so it can handle them. This could be a static declaration in the Slack integration module.

2. **Command Handler Contract** — Need a new pattern:
   ```typescript
   interface SlackCommandHandler {
     command: string  // e.g., '/order-status'
     handle(input: SlackCommandInput): Promise<SlackCommandResponse>
   }
   ```

3. **Deferred Responses** — When processing takes longer than 3 seconds, the handler must use the `response_url` to send a delayed response. Need async processing + response delivery.

4. **Modal Trigger** — Commands can open modals via `trigger_id`. The handler needs access to the Slack Web API client to call `views.open`.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Command handler contract | High | No existing adapter contract for request-response command handling. Need a new `SlackCommandHandler` interface or a generic `CommandAdapter` in the communication hub. |
| Deferred response pattern | Medium | Need to acknowledge immediately and respond later via `response_url`. The queue + callback pattern exists but isn't formalized for this use case. |
| Modal trigger forwarding | Medium | `trigger_id` has a 3-second expiry. Must open the modal synchronously within the initial request handler, before deferring to a worker. |

---

## 5. Interactive Components (Modals, Buttons, Menus) — Requires Design

### What Slack Needs

- Endpoint for `block_actions` payloads (button clicks, menu selections)
- Endpoint for `view_submission` payloads (modal form submissions)
- `views.open` / `views.update` / `views.push` API calls for modal management
- Action routing by `action_id` or `callback_id`
- Stateful modal flows (multi-step forms)

### Framework Fit

No existing pattern. The `ChannelAdapter` handles text messages. Interactive components are a different interaction paradigm entirely.

### Assessment: Requires Design

This is Slack's most powerful feature and the hardest to fit into the framework:

1. **Interaction Router** — A single `interactivity` URL receives all interaction payloads (button clicks, modal submissions, shortcuts). Need to route by `type` (block_actions, view_submission, view_closed, shortcut) and then by `action_id` or `callback_id`.

2. **Modal State Management** — Multi-step modals (e.g., "search customer → select customer → view details") require view stacking. The framework has no concept of stateful UI flows with external services.

3. **Action-to-Platform Mapping** — Button clicks on a Slack message (e.g., "Approve Order") need to trigger platform actions (update order status). This is essentially a reverse API call pattern — Slack triggers Open Mercato actions.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Interaction router | High | No pattern for routing interactive component callbacks. Need action_id/callback_id-based dispatch. |
| Modal lifecycle management | High | No framework concept for managing external UI flows. Would need a Slack-specific modal service. |
| Reverse action mapping | Medium | Mapping Slack button clicks to platform mutations. Could leverage existing API routes internally, but needs a dispatch layer. |

---

## 6. App Home Tab — Requires Design

### What Slack Needs

- `views.publish` API call to render a per-user home tab
- Update the home tab when relevant data changes
- Event subscription: `app_home_opened` to trigger re-rendering

### Framework Fit

No equivalent. The closest concept is the backend admin panel, but that's a web UI, not a Slack surface.

### Assessment: Requires Design

An App Home tab for Slack would show a personalized dashboard (today's orders, pending approvals, key metrics) rendered as Block Kit blocks. This requires:

1. A template engine to convert platform data into Block Kit JSON
2. A trigger mechanism to re-render when data changes (event subscriber)
3. Per-user context (the home tab is different for each Slack user)

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Home tab rendering engine | Medium | Need to convert platform data into Block Kit views. Could reuse the notification Block Kit renderer (gap #2.1). |
| User identity mapping | Medium | Need to map Slack user IDs to Open Mercato user IDs to personalize the home tab. No existing user mapping infrastructure. |
| Reactive updates | Low | Updating the home tab when data changes. Could use event subscribers to trigger `views.publish` on relevant events. |

---

## 7. User Identity Mapping — Requires Design

### What Slack Needs

- Map Slack user IDs (`U1234ABCD`) to Open Mercato user accounts
- Use `users:read.email` scope + `users.lookupByEmail` API for matching
- Store the mapping for reverse lookups (platform event → which Slack user to notify)

### Framework Fit

The integration framework has no concept of user identity mapping between external services and the platform. The `auth` module manages platform users but has no extension point for external identity linking.

### Assessment: Requires Design

User mapping is important for:
- Personalizing the App Home tab
- Sending DMs to specific users
- Attributing slash command actions to platform users
- Filtering notifications by user role/permissions

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| User mapping entity | Medium | Need `SlackUserMapping` (slackUserId, slackTeamId, platformUserId, organizationId, tenantId). No existing pattern. |
| Auto-mapping flow | Low | Could auto-map on first interaction by email match. Nice-to-have. |
| Extension to auth module | Low | Could use `data/extensions.ts` to link Slack identity to platform users. Pattern exists but hasn't been used for external identity providers. |

---

## 8. Multi-Workspace Support — Difficult

### What Slack Needs

- Enterprise Grid: one Slack organization, multiple workspaces
- One tenant might want the Slack integration installed across multiple workspaces
- Each workspace has its own bot token

### Framework Fit

The `IntegrationCredentials` entity stores **one set of credentials per integration per tenant**. A unique constraint on `(integrationId, organizationId, tenantId)` enforces this. There is no concept of multiple "connections" or "instances" of the same integration per tenant.

### Assessment: Difficult

Supporting multiple Slack workspaces per tenant would require:

1. **Multi-instance credentials** — Breaking the 1:1 constraint between integration and tenant. This is a fundamental change to the credentials model.
2. **Workspace selector** — Admin UI to manage multiple workspace connections
3. **Per-workspace routing** — Which workspace receives which notifications

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Multi-instance integration support | High | The credential model assumes one connection per integration per tenant. Supporting multiple workspaces requires architectural changes to `IntegrationCredentials` and `IntegrationState`. |
| Workspace routing logic | Medium | When sending a notification, need to determine which workspace(s) to send to. |

---

## 9. Slack Web API Client — Straightforward

### What Slack Needs

- HTTP client for calling Slack Web API methods (`chat.postMessage`, `conversations.list`, `views.open`, etc.)
- Token-based authentication (`Authorization: Bearer xoxb-...`)
- Rate limit handling (exponential backoff on HTTP 429)
- Typed method signatures

### Framework Fit

The framework uses `apiCall` for internal API calls. External HTTP calls are made directly (see inbox_ops webhook, Google Sheets API in SPEC-045g).

### Assessment: Straightforward

Building a Slack Web API client is standard adapter-level work:

```typescript
// channel_slack/lib/client.ts
class SlackApiClient {
  constructor(private botToken: string) {}

  async postMessage(channel: string, blocks: Block[], text: string): Promise<PostMessageResult>
  async conversationsList(): Promise<Channel[]>
  async viewsOpen(triggerId: string, view: View): Promise<ViewResult>
  // ... etc
}
```

This follows the same pattern as `channel_whatsapp/lib/client.ts`. No framework gaps.

### Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| Outbound rate limiter | Medium | Need backoff on 429 responses. Adapter-level concern but could benefit from a shared utility. |

---

## 10. Module Architecture Recommendation

### Recommended: Bundle Approach

Given that Slack spans multiple integration categories, the recommended architecture is an **integration bundle**:

```
packages/core/src/modules/channel_slack/
├── index.ts
├── integration.ts           # Bundle: notification + communication + commands
├── acl.ts                   # slack.view, slack.manage, slack.send
├── setup.ts                 # Register adapters, default channel mappings
├── di.ts                    # SlackClient, SlackEventRouter, SlackCommandRouter
├── events.ts                # slack.message.sent, slack.command.received, etc.
├── lib/
│   ├── client.ts            # Slack Web API client
│   ├── block-kit.ts         # Block Kit template engine
│   ├── event-router.ts      # Inbound event dispatcher
│   ├── command-router.ts    # Slash command dispatcher
│   ├── interaction-router.ts # Button/modal callback dispatcher
│   ├── notification-adapter.ts  # NotificationTransportAdapter implementation
│   └── user-mapping.ts      # Slack ↔ platform user mapping
├── data/
│   ├── entities.ts          # SlackChannelMapping, SlackUserMapping
│   └── validators.ts
├── api/
│   ├── post/slack/events.ts     # Slack Events API endpoint
│   ├── post/slack/commands.ts   # Slash command endpoint
│   ├── post/slack/interactive.ts # Interactive component endpoint
│   └── get/slack/channels.ts    # List channels for config UI
├── subscribers/
│   ├── order-notifications.ts   # Platform events → Slack messages
│   └── home-tab-updater.ts      # Data changes → App Home refresh
├── workers/
│   ├── message-sender.ts        # Rate-limited message delivery
│   └── event-processor.ts       # Async event processing
├── widgets/
│   └── injection/
│       └── channel-mapping/     # Channel routing config widget
├── backend/
│   └── slack/
│       └── settings/page.tsx    # Slack-specific settings page
└── i18n/
    ├── en.ts
    └── pl.ts
```

---

## Gap Summary Matrix

| # | Capability | Status | Effort | Framework Change Needed |
|---|-----------|--------|--------|------------------------|
| 1 | OAuth 2.0 authentication | Ready | Low | None |
| 2 | Credential storage & management | Ready | Low | None |
| 3 | Integration registry & discovery | Ready | Low | None |
| 4 | Operation logging | Ready | Low | None |
| 5 | Enable/disable per tenant | Ready | Low | None |
| 6 | Health check | Ready | Low | None |
| 7 | Basic message posting | Straightforward | Medium | None — adapter-level |
| 8 | Block Kit template engine | Straightforward | Medium | None — adapter-level |
| 9 | Slack Web API client | Straightforward | Medium | None — adapter-level |
| 10 | Channel routing config (widget) | Straightforward | Medium | None — uses widget injection |
| 11 | Notification type → channel mapping | Straightforward | Medium | New entity, adapter-level |
| 12 | Outbound rate limiting | Straightforward | Medium | Queue-based sending pattern |
| 13 | Inbound Events API (webhook) | Requires Design | High | New event dispatcher pattern |
| 14 | URL verification challenge | Requires Design | Low | One-off endpoint behavior |
| 15 | Slack signature verification | Straightforward | Low | Adapter-level |
| 16 | Slash command handling | Requires Design | High | New command handler contract |
| 17 | Deferred command responses | Requires Design | Medium | Acknowledge + queue + callback |
| 18 | Interactive components (buttons/menus) | Requires Design | High | New interaction router |
| 19 | Modal management | Requires Design | High | New modal lifecycle management |
| 20 | App Home tab | Requires Design | Medium | New rendering + trigger pattern |
| 21 | User identity mapping | Requires Design | Medium | New entity + mapping flow |
| 22 | Message shortcuts/actions | Requires Design | Medium | Routing infrastructure |
| 23 | Socket Mode (WebSocket) | Difficult | Very High | Persistent connection manager, new infra |
| 24 | Multi-workspace support | Difficult | Very High | Credential model changes |
| 25 | Thread grouping | Straightforward | Low | Store thread_ts per entity |

---

## Risk Assessment

### High Risk

1. **Scope creep** — Slack's API surface is enormous. A "full" integration could take months. Recommend phased approach starting with outbound notifications only.

2. **Socket Mode complexity** — Supporting behind-firewall deployments via WebSocket requires fundamentally new infrastructure (persistent connection manager, reconnection, heartbeat). Consider deferring or marking as Enterprise-only.

3. **Interactive component testing** — Modals and button callbacks require end-to-end testing with Slack's API. The integration test infrastructure (Playwright) can't simulate Slack interactions. Need mock Slack API server.

### Medium Risk

4. **Rate limiting** — Without outbound rate limiting, high-volume tenants could exhaust Slack's rate limits. A queue-based sender with per-channel concurrency control is essential.

5. **Block Kit maintenance** — Slack evolves Block Kit regularly. Templates will need maintenance as new block types are added or deprecated.

6. **User mapping accuracy** — Email-based auto-mapping assumes Slack and Open Mercato use the same email. This may not hold for all users.

---

## Phased Implementation Recommendation

### Phase 1 — Outbound Notifications (2-3 weeks)

**Scope**: Send platform notifications to Slack channels
**Uses**: `NotificationTransportAdapter`, OAuth credentials, operation logs, widget injection
**Framework changes**: None

Deliverables:
- `channel_slack` module with `integration.ts`
- Slack Web API client (`chat.postMessage`)
- `NotificationTransportAdapter` implementation
- Block Kit renderer for order/payment/inventory notifications
- Channel mapping config widget (notification type → Slack channel)
- Queue-based message sender with rate limiting

### Phase 2 — Inbound Events & Commands (3-4 weeks)

**Scope**: Receive Slack events, handle slash commands
**Uses**: Queue workers, event subscribers
**Framework changes**: New event dispatcher and command handler patterns (could be Slack-specific, not generalized)

Deliverables:
- Events API endpoint with signature verification
- URL verification challenge handler
- Event router (message, app_mention, reaction)
- Slash command endpoint and router
- `/order-status`, `/customer` command handlers
- Deferred response pattern
- User identity mapping entity

### Phase 3 — Interactive Features (3-4 weeks)

**Scope**: Buttons, modals, App Home
**Framework changes**: New interaction router (Slack-specific)

Deliverables:
- Interactive component endpoint
- Button action handlers (approve order, mark as reviewed)
- Modal flows (order detail, customer search)
- App Home tab with dashboard
- Message shortcuts (create note from message)

### Phase 4 — Advanced (optional, 2-3 weeks)

**Scope**: Socket Mode, multi-workspace, thread grouping
**Framework changes**: Significant — persistent WebSocket, credential model changes

Deliverables:
- Socket Mode connection manager
- Multi-workspace credential support
- Thread grouping for related notifications
- Scheduled summary messages (daily/weekly reports)

---

## Conclusion

The SPEC-045 integration framework covers approximately **40% of a full Slack integration** out of the box (authentication, credentials, registry, logging, basic notification transport). Another **30%** is achievable with adapter-level work that doesn't require framework changes (API client, Block Kit templates, channel routing). The remaining **30%** — inbound events, slash commands, interactive components, Socket Mode — requires new patterns that don't exist in any current hub contract.

The framework was designed primarily for **unidirectional integrations** (push notifications, pull data sync, payment capture). Slack is fundamentally **bidirectional and interactive** — it's both a notification target AND a command source AND an interactive UI surface. This multiplicity of interaction modes is what makes it challenging.

**Recommendation**: Implement Slack as a **self-contained module** (`channel_slack`) rather than trying to fit it into existing hub contracts. Use the hub adapters where they fit (notification transport) but implement Slack-specific features (commands, events, modals) as module-internal patterns. This avoids forcing premature abstractions into the framework while delivering a complete Slack integration.

If slash commands and interactive components prove useful for other integrations (Discord, Microsoft Teams), consider extracting common patterns into a new `team_collaboration` hub contract in a future spec.
