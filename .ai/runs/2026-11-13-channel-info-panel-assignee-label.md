# Execution Plan — channel info panel assignee label

## Goal

Show the assignee's name/email (not the raw user UUID) in the collapsed "Assigned to" dropdown of the Channel info panel on a channel message's detail page.

## Scope

- `packages/core/src/modules/communication_channels/widgets/injection/channel-info-panel/widget.client.tsx` — load the user options when the panel mounts (reassign-capable viewer with an assignee), not only when the dropdown opens.
- New regression test under `channel-info-panel/__tests__/`.

Root cause: `loadUsers()` runs only from the Select's `onOpenChange`; until then `users` is empty, so the only `SelectItem` matching `assignedUserId` is the fallback item whose label is the raw id, and the closed `SelectValue` renders it.

## Non-goals

- Read-only display (viewer without `communication_channels.assign`) still shows the raw id — resolving it needs a server-side label (enricher change).
- The `pageSize=50` cap on the user options list.
- No API, enricher, or contract changes.

## Risks

- One extra `GET /api/auth/users` on page load for assign-capable viewers of assigned channel messages; failure keeps today's fallback (raw id).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression test

- [x] 1.1 Load assignee options on mount in channel info panel — 252a662485
- [x] 1.2 Add regression test for the collapsed assignee label — b3026eea96
