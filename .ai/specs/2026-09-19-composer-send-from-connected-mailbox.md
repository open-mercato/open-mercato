# Composer: send from a connected mailbox

Issue: #6258

## TLDR

The message composer gets an explicit, per-message **Send from** selector. It lists the employee's connected email channels next to the default platform sender. Picking a mailbox routes the send through the existing `communication_channels` `sendAsUser` facade, so the outbound message gets an `ExternalConversation`, a `ChannelThreadMapping` and an outbound `MessageChannelLink` — and the client's reply threads back into Open Mercato automatically. Leaving the selector alone keeps today's platform-sender behaviour unchanged.

This is **not** a tenant-wide system sender. Transactional and system mail keeps using the platform's own SMTP configuration through `communication_channels/lib/system-email.ts`, which this change does not touch.

## Problem Statement

An employee composing a message to an external client at `/backend/messages/compose` always sends through the platform sender. The messages module's SMTP path writes none of the channel-side rows that threading depends on (`ExternalConversation`, `ChannelThreadMapping`, `ChannelThreadToken`, `MessageChannelLink`), and `lib/thread-matcher.ts` matches inbound replies only on those rows. The consequence: the client's reply lands as an unattributed inbound message instead of continuing the thread, and the employee's own mailbox has no record of the conversation.

The customers module already solved the same problem in a narrower place — `ComposeEmailDialog` has a "Send as" selector wired to `POST /api/communication_channels/send-as-user`. The general composer has no equivalent.

## Proposed Solution

Add a per-message sender choice to the composer, defaulting to the platform sender:

1. `packages/ui`'s `MessageComposer` accepts a **provider-agnostic** `senderOptions` prop and renders a "Send from" `Select` when the list is non-empty and the composer is in the external-recipient mode (`variant === 'compose'` and `visibility === 'public'`, the same gate the External email field already uses).
2. The messages module's `ComposeMessagePageClient` fills that list from `GET /api/communication_channels/me/channels`, filtered to `channelType === 'email'` **and** `status === 'connected'` (that endpoint filters server-side only on tenant/organization/user/deletedAt and returns every channel type the user owns). A failing or absent endpoint yields an empty list, so the selector simply does not render.
3. When a mailbox is selected, the composer adds `senderChannelId` to its existing `POST /api/messages` payload. The route resolves `communicationChannelsSendAsUser` through a soft-optional `tryResolve` and delegates the whole send to it; the platform path is untouched when the field is absent.
4. `sendAsUser`'s discriminated failure result (`{ ok: false, status, error, fieldErrors? }`) is re-keyed onto the composer's own field id and surfaced under the selector, so a mailbox in `requires_reauth` / `disconnected` (422) or a non-`connected` status (409) reads as a field error rather than a generic send failure.

### Architectural choice

**Chosen: (iii) — the composer posts `senderChannelId` to `/api/messages` and the route delegates to `communicationChannelsSendAsUser` via `tryResolve`**, with the UI surface limited to a generic, provider-agnostic option list.

Why:

- It is the only option where the threading rows are written by the code that already owns them. `sendAsUser` composes the Message through the `messages.messages.compose` command and then writes `ExternalConversation` + `ChannelThreadMapping` + the outbound `MessageChannelLink` in one transaction before enqueueing delivery. Reimplementing any part of that on the composer path would fork the invariant that `lib/thread-matcher.ts` depends on.
- The cross-module direction is the sanctioned one. `messages` is the optional consumer and owns the glue; `communication_channels` neither imports nor knows about the composer. The repo already has this exact shape: `messages/lib/composeSourceChannelType.ts` soft-resolves `communicationChannelsResolveChannelType` and degrades to "unknown" when the module is absent (root AGENTS.md → Cross-Module Coupling).
- `packages/ui` stays clean: it learns a `senderOptions`/`senderId` vocabulary and a `senderChannelId` request field, which are messages-API terms, not `communication_channels` terms. No import, no provider key, no channel status ever reaches `packages/ui`.

**Rejected (i) — widget injection into the composer's `InjectionSpot`.** The spot on `ComposeMessagePageClient` is a standalone sibling mount, not CrudForm field resolution — its own source comment states that the `crud-form:<entityId>:fields` pipeline (`onFieldChange`, value transformers) does not apply, because the page is not a CrudForm over the compose values. The composer's fields are custom-rendered against `useMessageCompose` state with `initialValues={{}}`, so an injected widget can render UI next to the composer but cannot write into its state and cannot replace its submit. The injection contract has no submit-override hook at all; only `widgets/components.ts` component replacement could reach the submit, and that would mean the channels module wrapping and re-implementing `MessageComposer`. Forcing this option would mean inventing a new extension-point contract for one feature.

**Rejected (ii) — a generic "send-as options + submit override" prop contract in `packages/ui`.** The options half of it is kept (that is the `senderOptions` prop). The **submit-override** half is rejected: it would give `packages/ui` a second, parallel write path whose payload, validation, guard execution and error shape diverge from `POST /api/messages`, and it would move the decision of which endpoint sends a message into a presentation package. The mutation guards (`runMessageMutationGuards`), the `messages.email` feature check and the OpenAPI contract all live on the route; an override would bypass or duplicate every one of them.

### Body format

`sendAsUser`'s `body` accepts `{ plain?, html? }`, so a markdown compose is **rendered to HTML** through `renderMarkdownEmailBody` — the same renderer the platform email path already uses — with the markdown source kept as the plain-text alternative. Sending the source as `plain` alone would deliver raw markup (asterisks, pipes, link syntax) to the client, a silent content degradation.

That renderer moved out of `messages/lib/email-sender.ts` into `messages/lib/markdownEmailBody.ts` so both delivery paths share one implementation; `email-sender.ts` now imports it and is otherwise unchanged.

Refusing a markdown body instead was considered and rejected: it would add a second surprising refusal to a path that already has one, for the composer's own first-class editing mode rather than an edge case, and it would make the mailbox path render *less* faithfully than the platform path it replaces.

### Known limitation

`sendAsUser`'s input contract carries recipients, subject, body and threading headers — it has no place for attachments, context objects or priority. Rather than silently dropping them, the route **rejects** a mailbox send that carries `attachmentIds` or `objects` with a 422 on the `senderChannelId` field. Carrying that payload through the hub is follow-up work (it needs a widened `SendAsUserInput` plus outbound-delivery support), tracked separately.

## Architecture

```
ComposeMessagePageClient (core/messages, client)
  └─ GET /api/communication_channels/me/channels   ── catch → []
     └─ toComposeSenderOptions()   filter: channelType==='email' && status==='connected'
        └─ <MessageComposer senderOptions=… />      (packages/ui — provider-agnostic)
             └─ POST /api/messages { …, senderChannelId? }
                  └─ api/route.ts POST
                       ├─ senderChannelId absent → commandBus 'messages.messages.compose'   (unchanged)
                       └─ senderChannelId present → tryResolve('communicationChannelsSendAsUser')
                                                     └─ sendAsUser(...)  → compose command
                                                                         → ExternalConversation
                                                                         → ChannelThreadMapping
                                                                         → MessageChannelLink (outbound)
                                                                         → outbound delivery queue
```

`communication_channels` is unchanged. With the module disabled, `tryResolveSendAsUserService` returns `undefined`, the route answers 422 on `senderChannelId`, and — because the channel list endpoint is also gone — the selector never renders in the first place, so the case is unreachable through the UI.

## Data Models

None. No entity, migration or snapshot change. All rows written on the mailbox path are the ones `sendAsUser` already writes.

## API Contracts

### `POST /api/messages` — additive optional field

| Field | Type | Notes |
|---|---|---|
| `senderChannelId` | `string` (uuid), optional | The employee-owned communication channel to send through. Absent or empty → platform sender, existing behaviour byte for byte. |

Accepted only on a non-draft, `visibility: 'public'` compose. Rejected with 422 when combined with `attachmentIds` or `objects` (see Known limitation). A `bodyFormat: 'markdown'` body is rendered to HTML before it reaches the hub (see Body format).

Every failure message on this path is translated server-side through `resolveTranslations()` against the `messages.errors.sender*` keys, which ship in all five locale files.

Failure responses on the mailbox path mirror `sendAsUser`'s status and message, with the field error re-keyed to the composer's field id:

```json
{ "error": "This channel needs reconnection before it can send messages. …",
  "fieldErrors": { "senderChannelId": "This channel needs reconnection before it can send messages. …" } }
```

Statuses passed through unchanged: `404` (channel not found), `403` (not the caller's channel), `422` (`requires_reauth` / `disconnected` / unsupported payload / module absent), `409` (channel not `connected`), `500`.

Success stays `{ id, threadId }` with status 201.

### `packages/ui` — `MessageComposerProps` additive props

```ts
export type MessageSenderOption = {
  id: string
  label: string
  description?: string | null
  /** Preferred pick when the user opts into a non-platform sender; does not preselect. */
  isDefault?: boolean
}

senderOptions?: MessageSenderOption[]
```

Both additive and optional; every existing `MessageComposer` call site keeps compiling and behaving identically.

## Migration & Backward Compatibility

Contract surfaces touched, classified per `BACKWARD_COMPATIBILITY.md`:

| Surface | Change | Class |
|---|---|---|
| `POST /api/messages` request body | new optional `senderChannelId` | ADDITIVE-ONLY — omitting it reproduces current behaviour exactly |
| `composeMessageSchema` / `composeMessageRequestSchema` | new optional field | ADDITIVE-ONLY |
| `MessageComposerProps` (public type, `@open-mercato/ui/backend/messages`) | new optional `senderOptions`; new exported `MessageSenderOption` | ADDITIVE-ONLY |
| `UseMessageComposeResult` | new `senderChannelId` / `setSenderChannelId` / `senderOptions` / `submitFieldErrors` members | ADDITIVE-ONLY on a returned object |
| DI keys | none added; `communicationChannelsSendAsUser` consumed as-is | unchanged |
| Event ids, widget spot ids, ACL features, DB schema, CLI, notification ids | none | unchanged |

No deprecation protocol applies: nothing is removed, renamed or narrowed. No `UPGRADE_NOTES.md` entry is required. The messages module keeps working with `communication_channels` disabled — verified by `packages/core/src/__tests__/module-decoupling.test.ts` and by the unit test asserting the route's behaviour when the facade cannot be resolved.

## Risks & Impact Review

| # | Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | The mailbox path silently drops attachments or context objects | High | messages compose | Route returns 422 on `senderChannelId` instead of sending; the composer shows it on the field | User must remove attachments or send via the platform sender until the follow-up lands |
| 1b | A markdown compose reaches the client as raw markup | High | outbound content | Markdown is rendered to `body.html` with the platform path's own renderer, markdown source kept as `body.plain`; unit-tested | Rendering differences between the two paths are impossible: they share one renderer |
| 2 | Duplicate send — a `send_as_user`-sourced message also triggers a platform SMTP send | High | messages notification subscriber | Out of scope here: handled by the concurrent fix in `messages/subscribers/message-notification.ts`, which keys on `sourceEntityType === 'communication_channels.send_as_user'` — the exact value this path produces | Depends on that fix landing; without it a mailbox send double-delivers |
| 3 | A user selects a mailbox that has gone stale between page load and send | Medium | UX | `sendAsUser` re-validates ownership and status at send time and returns 422/409; the composer shows the message on the field, not as a generic failure | User re-picks or reconnects the mailbox |
| 4 | The selector leaks non-email channels (Discord, Slack) as "mailboxes" | Medium | UX / delivery | `toComposeSenderOptions` filters on `channelType === 'email'` as well as `status === 'connected'`; unit-tested | None |
| 5 | `packages/ui` acquires a dependency on `communication_channels` | Medium | architecture | The prop contract is provider-agnostic; the channel fetch and the filtering both live in the messages module | None |
| 6 | Cross-tenant send through someone else's channel id | High | security | `sendAsUser` loads the channel scoped to `{ tenantId, organizationId, deletedAt: null }` and rejects `channel.userId !== actor.userId` with 403, before any write | None |

### Security impact

The new field is a channel id supplied by the client. It is never trusted: the route forwards it to `sendAsUser`, which resolves the channel inside the caller's tenant/organization scope and refuses a channel the caller does not own. The existing `messages.email` feature gate and the message mutation guards run **before** delegation, so the mailbox path is no less guarded than the platform path. No credential, token or provider secret crosses the API boundary — the selector only ever sees a channel id, a display name and an external identifier the user already sees on their own profile page.

## Integration Coverage

Affected API paths and UI paths, with the tests shipping in this change:

| Path | Coverage |
|---|---|
| `POST /api/messages` with `senderChannelId` (happy path) | `packages/core/src/modules/communication_channels/__integration__/TC-CHANNEL-EMAIL-HUB-004.spec.ts` — seeds a connected channel, composes through the composer's own endpoint, asserts 201 and that an outbound `MessageChannelLink` plus a `ChannelThreadMapping` exist for the thread |
| `POST /api/messages` with an unknown/foreign `senderChannelId` | same spec — asserts 404/403 rather than a platform-sender fallback |
| `POST /api/messages` without `senderChannelId` | same spec — asserts the platform path still answers 201 and writes no channel link |
| `GET /api/communication_channels/me/channels` shape the selector consumes | existing `TC-CHANNEL-EMAIL-HUB-001.spec.ts` |
| Composer UI — selector visibility, default, payload | unit tests in `packages/ui/src/backend/messages/__tests__/` and `packages/core/src/modules/messages/lib/__tests__/composeSenderOptions.test.ts` |
| Route delegation, body-format handling, error mapping, module-absent behaviour | `packages/core/src/modules/messages/lib/__tests__/composeSenderDelegation.test.ts` |

Integration tests are self-contained: the channel is seeded per test through the env-gated `test-seed` fixture and deleted in `finally`; nothing relies on seeded or demo data, and the suite skips when `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.

## Final Compliance Report

- No `communication_channels` import or vocabulary in `packages/ui`.
- No raw `fetch`; all calls go through `apiCall` from `@open-mercato/ui/backend/utils/apiCall`.
- No hard-coded user-facing strings: the composer labels use `useT()` and the delegation's failure messages use `resolveTranslations()`; all six new keys ship in all five messages locale files.
- No hardcoded Tailwind status colors, no arbitrary values, no `dark:` overrides on semantic tokens; the selector reuses the existing `Select`, `Label` and `text-destructive` surface the composer already uses.
- `system-email.ts` untouched; no tenant-wide sender introduced.
- `messages/subscribers/message-notification.ts` untouched (owned by the concurrent duplicate-send fix).

## Changelog

- 2026-09-19 — Spec written. Architectural choice recorded: route-level delegation to `sendAsUser` with a provider-agnostic UI option contract; widget injection and a UI-level submit override rejected.
- 2026-09-19 — Review follow-up: delegation failure messages moved onto `messages.errors.sender*` locale keys resolved server-side; markdown bodies rendered to HTML through the shared `renderMarkdownEmailBody` instead of being sent as raw source.
