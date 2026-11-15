# Profile Communication Channels — Row Actions Column

**Status:** Implemented on this branch, pending review
**Base:** `upstream/develop` @ `12f434927`
**Page:** `/backend/profile/communication-channels`
**Module:** `packages/core/src/modules/communication_channels`

## 📝 TLDR

The profile channel table carried one column per action — `Primary` and `Push` held
inline buttons, and `History`, `Sync` and `Connection` existed only to hold a button
each. Nine columns pushed the row past the viewport and clipped the trailing actions.

Every per-row action moves into the ⋯ menu, handed to `DataTable` through its native
`rowActions` prop. `Primary`, `Team access` and `Push` become status-only. The table
goes from 11 columns to 8 plus DataTable's own actions cell, and adding a future
action costs a menu entry instead of a column.

The consolidation itself changes no contract surface: no DB, API, event, ACL, DI or
widget spot-ID change. The later `set-primary` refusal of a `disconnected` channel
(#7799) narrows one API route and one exported command result; see
[Data Model / API Contracts](#-data-model--api-contracts).

## 📝 Problem Statement

Columns before this change:

```
Channel · Provider · External ID · Primary* · Team access* · Status · Push* · Last synced · History · Sync · Connection
                                  ^button     ^button              ^button              ^button  ^button ^button
```

Six of eleven columns existed wholly or partly to carry a button. Three of those
buttons were frequently *disabled* — `History` on non-email channels, `Sync` on
push-driven ones — so they consumed horizontal space to render an affordance the user
could not use.

The header's connect-button overflow (#5595) is a separate, already-solved problem:
`ConnectChannelMenu` collapses the injected provider controls into one dropdown. This
change does not touch it.

## 📝 Existing Architecture (built on, not re-specified here)

- **Channel sharing** — `CommunicationChannel.visibility`, the
  `communication_channels.share_own_channel` feature, `PUT
  /api/communication_channels/channels/[id]/visibility`, the `set-channel-visibility`
  command, and read-time enforcement through
  `applyEmailVisibilityFilter({ sharedChannelIds })`. Unchanged.
- **`ConnectChannelMenu`** (#5595) — the header's single connect entry point.
  Unchanged; its mounted-panel design is what keeps a provider's own credential
  dialog alive while the panel closes.
- **`RowActions` / `RowActionItem`** — `packages/ui/src/backend/RowActions.tsx`.
- **Push capability flags** (#4980) — `supportsRealtimePush` (the poll worker skips
  the channel) and `supportsPushRegistration` (a subscription can be registered) are
  distinct and are read from the adapter, never from the provider name.

## 📝 Proposed Solution

### Integration point: `DataTable.rowActions`, not a column

The menu is passed as `rowActions={(row) => <RowActions items={…} />}` rather than
rendered from a hand-rolled `actions` column. This matters beyond style:

- `DataTable` merges **row actions injected by other modules** into the same menu
  (this table declares `extensionTableId={…profileChannelsTable.tableId}`), deduping
  by `id` and honouring each injected action's `placement`. A hand-rolled column
  would have left injected actions to render a *second* ⋯ menu beside the first.
- The table owns the actions cell's header (`ui.dataTable.actionsColumn`, already
  translated app-side), its right alignment, and its optional sticky behaviour.
- `pickDefaultRowAction` can promote an action to the row-click handler.

Consequently this change adds **no** `columns.actions` i18n key — the header is the
table's, not the page's.

### Menu composition

Built per row, in this order. An action that does not apply is **omitted**, never
disabled — `RowActionItem` has no disabled state, and a menu of greyed-out entries
is worse than a short menu.

| Action | Included when | Notes |
|---|---|---|
| `set-primary` | `!isPrimary && status !== 'disconnected'` | The set-primary route refuses a disconnected channel with 409 `channel_disconnected` |
| `share-with-team` / `make-private` | `channelType === 'email'` | Label flips on `visibility` |
| `register-push` | `supportsPushRegistration && pushStatus !== 'active'` | Re-registering a healthy subscription is a no-op |
| `import-history` | `isActive && status === 'connected' && channelType === 'email'` | Same rule the `History` column enforced |
| `poll-now` | `isActive && !supportsRealtimePush && status ∈ {connected, error}` | Label is `Retry` when `status === 'error'` |
| `disconnect` | always | `destructive: true` |

`disconnect` being unconditional means the menu is never empty, so `RowActions`
never returns `null` on this page.

### Eligibility rules preserved verbatim

Three rules previously lived in the removed columns and are carried over unchanged:

- **Email-only sharing.** Only email ingestion writes `customer_interactions`, so on
  a chat or push channel a share would flip the flag and flash success while changing
  nothing anyone can observe.
- **Poll from `error` as well as `connected`.** This lets a user recover a stuck
  channel without a disconnect/reconnect cycle. `requires_reauth` and `disconnected`
  belong to other flows.
- **Never poll a push-driven channel** (#4980). The worker skips it by definition, so
  offering the action would promise a sync that cannot happen.

### Where the removed explanations went

The disabled `Sync` button carried its own justification in an `aria-label`, wrapped
in a `<span title>` because a disabled button does not reliably receive hover events.
Removing the button would have dropped that text, so the explanation moves onto the
`Push-driven` status tag in the `Push` column — the cell that states the condition it
explains. This is asserted by a test, because it is the kind of copy that silently
disappears in a refactor.

## 📝 Data Model / API Contracts

`GET /api/communication_channels/me/channels` is unchanged. It already returns every
field the menu reads (`isPrimary`, `visibility`, `updatedAt`, `isActive`, `status`,
`channelType`, `pushStatus`, `supportsRealtimePush`, `supportsPushRegistration`).

**`set-primary` refuses a disconnected channel (#7799).**

- `POST /api/communication_channels/channels/{id}/set-primary` answers
  `409 { error, code: "channel_disconnected" }` for a channel whose `status` is
  `disconnected`, and leaves the current primary unchanged. It previously answered `200`
  and promoted the channel. A legacy row that is disconnected and still flagged primary
  also gets `409` instead of the `200` no-op. `connected`, `requires_reauth` and `error`
  channels are accepted as before. The `409` is listed in the route's OpenAPI responses.
- The `communication_channels.channel.set_primary` command returns the new
  `SetPrimaryChannelResult` member `{ status: 'disconnected'; reason: string }`. It is
  checked after ownership (another user's channel still gets the masked `404`) and
  before the already-primary no-op, and it writes nothing.
- URL, request shape, success response, event IDs, ACL features, DI names and database
  schema are unchanged.

## 📝 UI/UX

Columns after: `Channel · Provider · External ID · Primary · Team access · Status ·
Push · Last synced`, followed by DataTable's own right-aligned actions cell.

- `Primary` renders the `Primary` tag or an em dash.
- `Team access` renders `Shared` / `Only you`, or an em dash on non-email channels.
- `Push` renders status only.
- Sharing keeps its confirmation on the widening direction (`private → shared`) via
  `useConfirmDialog`; narrowing stays one click. `ConfirmDialog` supplies
  `Escape` to cancel and `Cmd/Ctrl+Enter` to submit.
- The ⋯ trigger has a visually-hidden `Open actions` label, and `Escape` closes the
  menu and returns focus to the trigger (both from `RowActions`).

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Channel is primary | `set-primary` omitted; `Primary` tag shown in its column |
| Non-email channel | Share and import omitted; `Team access` shows an em dash |
| Push-driven channel | `poll-now` omitted; reason on the `Push-driven` tag's `title` |
| Push already active | `register-push` omitted |
| Channel in `error` | `poll-now` present, labelled `Retry` |
| Channel in `requires_reauth` | Only `set-primary`, share and `disconnect`; the `Status` column explains why |
| Channel `disconnected` | Only share and `disconnect`; the `Status` column explains why |
| Every optional action ineligible | `disconnect` still present, so the menu is never empty |

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Actions less discoverable behind ⋯ | Low | Matches the established backend pattern; status columns still state each condition |
| An omitted action reads as a missing feature | Low | The `Status` and `Push` columns state the reason; the push-driven case keeps an explicit tooltip |
| Removed i18n keys leave a third-party override inert | Low | Locale keys are not a frozen contract surface per `BACKWARD_COMPATIBILITY.md` |

## 📝 Migration & Backward Compatibility

**Removed keys** — `communication_channels.profile.columns.disconnect`,
`.importHistory`, `.pollNow`, across all five bundled locales (en, de, es, ko, pl).
**No keys added** — the actions cell's header comes from `ui.dataTable.actionsColumn`,
which DataTable already owns and which is already translated app-side.

**`set-primary` refusal (#7799)** — an intentional narrowing of one API route's behaviour and
an exported command result type, recorded in `UPGRADE_NOTES.md`:

- HTTP consumers of `POST /api/communication_channels/channels/{id}/set-primary` must
  handle `409` with `code: "channel_disconnected"`; the call no longer promotes a
  disconnected channel.
- Code that switches exhaustively over `SetPrimaryChannelResult` must add a branch for
  `{ status: 'disconnected'; reason: string }`. The only in-repo consumer is the route.
- No bridge is provided: promoting a channel that cannot send is the defect being
  removed. No data migration is needed.

No other contract surface is touched. `channel-*` packages are unaffected: the
injection spot and its contract are untouched by this change.

## 📝 Phasing

Single phase — one page, its test, and five locale files.

## 📝 Integration Test Coverage

`backend/profile/communication-channels/__tests__/page.pushColumn.test.tsx` — extended
with a `row actions menu` suite:

| Assertion | Guards |
|---|---|
| `importHistory` / `pollNow` / `disconnect` columns gone, no `actions` column, `rowActions` prop supplied | The consolidation, and that injected row actions can still merge |
| `Disconnect` always present and carries destructive styling | Menu is never empty |
| `Set as primary` omitted when already primary | Eligibility |
| `Share with team` / `Make private` flip on `visibility` | Label correctness |
| Share omitted on a non-email channel | The email-only rule |
| `Import history` only when connected, active and email | Eligibility |
| `Poll now` omitted for push-driven; present for hub-polled | #4980 |
| Poll action labelled `Retry` on `status === 'error'` | Recovery path |
| Re-register push absent from the Push cell, present in the menu | Nothing lost in the move |
| Push-driven tag carries the "polling does not apply" title | The relocated explanation |
| `Set as primary` omitted on a `disconnected` row, kept for `connected`, `requires_reauth` and `error` | #7799 |

Playwright integration cases added for #7799:

| Case | Guards |
|---|---|
| `TC-CHANNEL-API-011` | `set-primary` on a disconnected channel answers `409` `channel_disconnected` and the current primary stays primary |
| `TC-CHANNEL-EMAIL-HUB-009` | The row menu of a disconnected channel has no `Set as primary`; a connected row still offers it |

## 📝 Prior Specs Reviewed

- `2026-08-25-crm-channel-shared-visibility.md` — the sharing feature this page
  surfaces; its API and enforcement are unchanged here.
- `2026-07-03-push-channels-tenant-scope.md` — tenant-scoped push channels.
- `2026-06-19-discord-communication-channel-integration.md` — a third injected connect
  provider; context for the header work this change deliberately leaves alone.

## 📝 QA Follow-ups (2026-09-30)

Manual QA returned NO-GO on three points. All are fixed on this branch.

### #6717 — Actions cell out of view at laptop widths (blocking)

The table is wider than a laptop viewport, so at 1280px the row ran out before the
actions cell; reaching ⋯ meant scrolling to the far end, which scrolled the `Channel`
column away, leaving no way to tell which channel an open menu belonged to. With
`Primary`, `Team access` and `Push` now status-only, no clickable control remained in
the visible part of the row at all.

**Fix:** `stickyActionsColumn` on the `DataTable`. The prop already existed and
defaults to `false`; this table needs it because consolidating the actions is what
made the trailing cell the *only* interactive one.

### #6718 — Menu not operable with arrow keys (blocking)

`Enter`/`Space` opened the menu and `Escape` closed it, but the arrow keys did
nothing and focus stayed on the trigger. Because every row's trigger is in the tab
order, reaching the first item of a six-row table took eleven `Tab` presses.

**Fix:** roving focus in `RowActions` — `ArrowDown`/`ArrowUp` with wraparound,
`Home`/`End`, and `Tab`/`Shift+Tab` trapped inside the open menu (a menu is modal for
the keyboard; letting `Tab` escape into the next row's trigger is what produced the
eleven presses). The first item takes focus on open, one frame after mount because the
panel is portalled.

### #6719 — Menu label overflows the panel (minor)

The panel had a fixed `w-44`. `RowActionItem` labels render as `Button`s, which are
`whitespace-nowrap`, so a label wider than the panel overhung its right border instead
of wrapping — Polish `"Zarejestruj push ponownie"` by ~10px.

**Fix:** `w-max min-w-44 max-w-xs` on the panel, and `whitespace-normal h-auto` on the
items so a label that reaches the cap wraps rather than overflowing.

This is the same defect `ActionsDropdown` carried as **#3580** (Polish
`"Oznacz wszystko jako nieprzeczytane"` overflowing a fixed `w-52`), fixed there the
same way. The two components now behave identically, and both are covered by tests
asserting the absence of the fixed-width class.

> `"Establecer como principal"` (es, *Set as primary*) is 25 characters — exactly as
> long as the Polish label QA reported, and it renders on any non-primary channel. QA
> did not test Spanish; the same fix covers it.

### Blast radius

#6718 and #6719 change the shared `RowActions` component, so they affect every
backend table that uses it, not just this page. Both are strict improvements
(keyboard access added; width floor unchanged at `min-w-44`), and the full
`packages/ui` suite passes.

## 📝 Changelog

| Date | Change |
|---|---|
| 2026-09-28 | Initial spec and implementation: per-row actions consolidated into a `RowActions` column. |
| 2026-09-30 | QA follow-ups: pinned the actions cell (#6717); added arrow-key/Home/End navigation and a Tab trap to `RowActions` (#6718); made the panel size to its content and its items wrap (#6719). |
| 2026-10-18 | `set-primary` omitted on a `disconnected` row, matching the route's new 409 refusal (#7799). |
| 2026-10-23 | Recorded the #7799 `set-primary` 409 and the new `SetPrimaryChannelResult` member in the API contract and backward-compatibility sections, and listed its integration cases. |
