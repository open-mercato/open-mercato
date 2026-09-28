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

No contract surface changes: no DB, API, event, ACL, DI or widget spot-ID change.

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
| `set-primary` | `!isPrimary` | |
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

Unchanged. `GET /api/communication_channels/me/channels` already returns every field
the menu reads (`isPrimary`, `visibility`, `updatedAt`, `isActive`, `status`,
`channelType`, `pushStatus`, `supportsRealtimePush`, `supportsPushRegistration`).

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
| Channel in `requires_reauth` / `disconnected` | Only `set-primary`, share and `disconnect`; the `Status` column explains why |
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

## 📝 Prior Specs Reviewed

- `2026-08-25-crm-channel-shared-visibility.md` — the sharing feature this page
  surfaces; its API and enforcement are unchanged here.
- `2026-07-03-push-channels-tenant-scope.md` — tenant-scoped push channels.
- `2026-06-19-discord-communication-channel-integration.md` — a third injected connect
  provider; context for the header work this change deliberately leaves alone.

## 📝 Changelog

| Date | Change |
|---|---|
| 2026-09-28 | Initial spec and implementation: per-row actions consolidated into a `RowActions` column. |
