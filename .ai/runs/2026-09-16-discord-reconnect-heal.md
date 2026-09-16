# Execution plan — Discord reconnect heals the existing channel (#4977)

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Goal

Reconnecting a Discord channel updates the user's existing channel row (status back to `connected`,
`last_error` cleared) instead of inserting a duplicate row next to a stuck `requires_reauth` one.

## Background

The connect command derives a channel's identity only from `username` / `email` / `fromAddress` in the
credential bag. Discord credentials carry none of them, so `externalIdentifier` is `NULL` and
`createConnectedChannelRow` skips the heal-on-reconnect lookup. After a fatal Gateway close (#4979)
the quarantined row can never be healed: every reconnect inserts a new row and the old one keeps
showing "Needs reconnection".

## Scope

- `communication_channels` hub: additive, optional `externalIdentifier` on
  `ValidateCredentialsResult`; the connect command prefers it over the credential-bag sniffing.
- `createConnectedChannelRow`: when the identifier came from the adapter and no row matches it,
  adopt the user's legacy identifier-less row of the same provider (rows created before this fix)
  so an already-stuck channel heals on the next reconnect.
- `channel_discord` adapter: return `discord:<applicationId>` from `validateCredentials`.
- Unit regression tests for all three.

## Non-goals

- Cleaning up more than one legacy duplicate row (only one is adopted; extra rows stay as they are).
- Changing the per-user credential storage model or the Gateway worker.
- Email providers: their identity derivation is unchanged.

## Risks

- Contract surface: `ValidateCredentialsResult` gains an optional field (additive-only, BC-safe).
- Legacy adoption is gated on an adapter-supplied identifier, so Gmail/IMAP/push flows are unaffected.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Hub contract and connect flow

- [x] 1.1 Add optional externalIdentifier to ValidateCredentialsResult and prefer it in the connect command — 0fecdc1a2
- [x] 1.2 Adopt a legacy identifier-less row when the adapter supplied the identifier — 0fecdc1a2
- [x] 1.3 Unit tests for the connect command and createConnectedChannelRow — 0fecdc1a2

### Phase 2: Discord provider

- [x] 2.1 Return a stable discord:<applicationId> identifier from validateCredentials — b70bb8ea3
- [x] 2.2 Unit test for the Discord identifier — b70bb8ea3
