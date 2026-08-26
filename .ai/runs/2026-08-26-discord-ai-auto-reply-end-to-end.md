# Execution plan — fix the channel_discord AI auto-reply end to end

- **Slug:** `discord-ai-auto-reply-end-to-end`
- **Branch:** `fix/discord-ai-auto-reply-end-to-end`
- **Base:** `develop`
- **Engine:** om-auto-create-pr (steps: 11, --loop: no)
- **Closes:** #5599, #5601, #5602, #5603
- **Source doc:** `.ai/specs/2026-06-19-discord-communication-channel-integration.md` (§ AI bot wiring, § Open decision — hub sender-identity contract)

## Goal

Make the Discord AI auto-reply feature shipped in #4778 / #4391 actually work end to end: the panel
that configures it must list the channels operators really have, an auto-sent reply must clear the
hub's compose validator, the tenant channel-bot identity must resolve, and a failed run must tell the
operator something they can act on.

## Scope

Four independent defects, all on the same feature, all found in one manual-QA round of #4391 on head
`7db14ebdd`:

1. **#5602 — the panel is structurally empty.** `api/ai-auto-reply/channels/route.ts:64` filters
   `userId: null`, but every route the product exposes for connecting a Discord bot writes
   `userId: auth.sub` (the connect widget posts to `/channels/connect/credentials`, and the
   tenant-wide route refuses Discord outright because the adapter declares no `channelScope`). The
   panel is the only entry point to the per-channel AI settings, so the feature has no way in.
2. **#5601 — the auto-send always throws.** `subscribers/ai-auto-reply.ts:260` composes a public
   `channel.discord` message without `sourceChannelType`, and `channelTypeRequiresExternalEmail`
   fails closed on an absent type, so `composeMessageSchema` demands an `externalEmail` the sender
   cannot have. The subscriber degrades to a no-op and the Discord user gets silence.
3. **#5599 — the channel-bot identity never resolves.** `communication_channels/lib/system-user.ts:60`
   matches a plaintext email against `users.email`, which is encrypted at rest with a per-row IV. The
   lookup can never hit, so inbound attribution falls back to the sentinel UUID and the documented
   escape hatch for widening/narrowing the auto-reply principal does not work.
4. **#5603 — the failure banner says `agent <id>: [`.** `lib/failure-reason.ts:45` keeps a message's
   first line; `ZodError.message` is pretty-printed JSON, whose first line is a bare `[`.

### Non-goals

- **Not** changing who may connect a Discord bot. Issue #5602 offers `channelScope: 'tenant'` on the
  adapter as candidate fix 1; that reroutes connects through the admin-gated tenant route and would
  strand every already-connected per-user channel. Candidate fix 2 (drop the `userId` filter and lean
  on the access guards) is the reversible one and is what this run implements.
- **Not** fixing #5600 (`useParams()` on the settings page). Separate issue, separate defect.
- **Not** adding a row action or menu entry to reach the settings page another way. The panel is the
  designed entry point; making it work is enough.
- **Not** relaxing the hub's fail-closed `externalEmail` rule. The call sites learn to declare their
  channel type; the validator keeps its default.

## Implementation plan

### Phase 1 — hub identity and the operator-facing failure reason

The two defects that are contained to one function each, and that nothing else in the run depends on.

- **1.1** Look the per-tenant channel-bot user up by `email_hash` (`lookupHashCandidates`, matching
  what the auth module writes) instead of by the encrypted `email` column, and exclude soft-deleted
  rows. Keep the helper's raw, table-name-driven query builder so it still pulls no cross-module
  entity class, and keep it fail-soft.
- **1.2** Make `describeAgentFailure` pick a line that carries information: special-case `ZodError`
  (first issue's `path` + `message`), and otherwise collapse whitespace across the whole message and
  skip bracket-only fragments. Redaction stays byte-for-byte as it is.

### Phase 2 — the send path

- **2.1** Declare `sourceChannelType` on the auto-reply compose input, and regression-test the
  composed payload against the **real** `composeMessageSchema` rather than against a hand-written
  expectation, so the test fails for the reason production failed.
- **2.2** Same declaration on the proposal-approve command, which composes the identical public reply
  through the identical path and carries the identical defect — the human-approved send is as broken
  as the automatic one.

### Phase 3 — the panel listing route

- **3.1** Add a `channelOwnerScopeWhere` helper next to `assertCanAccessChannel` in the hub's
  access-control module, expressing the same owner-only rule at the SQL layer: tenant-wide channels
  plus the caller's own personal ones.
- **3.2** Use it in the panel route in place of the `userId: null` filter, combining it with the
  existing org-scope fragment under `$and` so neither clause swallows the other.

### Phase 4 — integration coverage

- **4.1** Let the env-gated test-seed `connect-channel` action label the network-free stub channel
  with a caller-supplied provider key, so a provider-scoped listing can be exercised in CI without a
  live Discord bot token (the real adapter's `validateCredentials` performs a live API call).
- **4.2** `TC-CHANNEL-DISCORD-009` — the panel listing route returns the per-user Discord channel the
  connect widget actually creates, and does not return another user's.
- **4.3** `TC-CHANNEL-DISCORD-010` — the send path: a public reply composed on an addressless chat
  channel is accepted by the hub over HTTP, end to end.

### Phase 5 — documentation and the gate

- **5.1** Record the four fixes in the Discord spec's changelog.
- **5.2** Run the full `validation.commands` gate.

## Risks

- **Widening the panel listing (3.2).** Dropping `userId: null` must not turn the panel into a way to
  see somebody else's personal channel. Mitigated by mirroring `assertCanAccessChannel` exactly — the
  new clause admits `user_id IS NULL` or `user_id = <caller>`, nothing more — and by an integration
  test that asserts a second user's channel is absent.
- **Changing an encrypted-column lookup (1.1).** A wrong hash context would silently keep the lookup
  broken rather than fail loudly. Mitigated by reusing the auth module's own
  `emailHashLookupValues`, which is the function that computes what gets written.
- **Test-only surface (4.1).** A new knob on a seeding endpoint. Mitigated by the endpoint's existing
  fail-closed `OM_ENABLE_TEST_CHANNEL_SEEDING` gate (404 in production) and by keeping the knob
  purely cosmetic — it relabels a stub channel, it does not register an adapter.

## Progress

PR: #5639

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Hub identity and failure reason

- [x] 1.1 Resolve the channel-bot user by email_hash instead of the encrypted email column (#5599) — 16a109d6f
- [x] 1.2 Make describeAgentFailure informative for ZodError and multi-line errors (#5603) — 74f3ee942

### Phase 2: Send path

- [x] 2.1 Declare sourceChannelType on the AI auto-reply compose (#5601) — 5c6a06b92
- [x] 2.2 Declare sourceChannelType on the proposal-approve compose (#5601) — 5c6a06b92

### Phase 3: Panel listing route

- [x] 3.1 Add channelOwnerScopeWhere to the hub access-control helpers (#5602) — 6cd2338a9
- [x] 3.2 Replace the panel route's userId: null filter with the owner-scope clause (#5602) — 6cd2338a9

### Phase 4: Integration coverage

- [x] 4.1 Let the test-seed connect action label a stub channel with a provider key — 72e09e629
- [x] 4.2 TC-CHANNEL-DISCORD-009 — the panel lists per-user Discord channels — 0d64048ec (shipped as TC-CHANNEL-DISCORD-011; 009/010 stay reserved for #4665's live-Discord coverage)
- [x] 4.3 TC-CHANNEL-DISCORD-010 — the send path composes without an address — 0d64048ec (shipped as TC-CHANNEL-DISCORD-012)

### Phase 5: Documentation and the gate

- [x] 5.1 Record the fixes in the Discord spec changelog — 48664e1c6
- [x] 5.2 Run the full validation gate — green: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage (advisory), typecheck, test (34/34 workspaces, 11 560 core tests), build:app
