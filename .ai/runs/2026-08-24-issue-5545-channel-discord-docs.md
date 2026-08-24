# Run: channel-discord documentation (issue #5545)

**Issue:** [#5545](https://github.com/open-mercato/open-mercato/issues/5545) — `docs(channel-discord): official Discord integration guide + developer guide for building on the communications hub`
**Base branch:** `develop`
**Branch:** `feat/issue-5545-channel-discord-docs`
**Source doc:** `.ai/specs/2026-06-19-discord-communication-channel-integration.md` (lives on the #4391 branch, not on `develop`)

## Goal

Ship the two documentation pages #4391 deliberately left out: an operator guide for connecting a
Discord bot, and a developer guide for consuming the Communications Hub from another module and for
building a new provider on it — with the first release's capability ceiling stated honestly.

## Scope

- **New:** `apps/docs/docs/user-guide/communication-channels-discord.mdx` — operator guide.
- **New:** `apps/docs/docs/framework/modules/building-communication-channel-provider.mdx` — developer
  guide, `channel-discord` as the worked example, mirroring the shape of the existing
  `building-gateway-provider.mdx`.
- **Edit:** `apps/docs/docs/framework/modules/communication-channels.mdx` — list Discord among the
  shipping providers, link the new developer guide.
- **Edit:** `apps/docs/docs/user-guide/communication-channels.mdx`, `…-gmail.mdx`, `…-imap.mdx` —
  enumerate Discord, cross-link from "Related".
- **Edit:** `apps/docs/sidebars.ts` — both new pages reachable from the nav; add the hub's framework
  page, which is currently orphaned from the sidebar.

### Dependency

The provider package (`packages/channel-discord`) is **not on `develop`** — it ships with
[#4391](https://github.com/open-mercato/open-mercato/pull/4391), still open. Every fact in these
pages is taken from that branch's source, not from the spec (which is stale in places: it names an
interactions URL and a `register-slash-commands` CLI command the implementation does not ship). This
PR must therefore land **after** #4391, or the docs describe a package the installation does not have.

### Non-goals

- No code changes to `packages/channel-discord` or to the hub. Documentation only.
- Do not document AI auto-reply as a feature (#4778) or slash-command round-trip (#4663) as working.
- Do not fix the hub gaps the writing exposes (`/send-as-user` still validates recipients as email
  addresses, so it rejects a Discord snowflake). Document the limitation; fixing it is out of scope.
- No changes to `.env.example` — the `OM_CHANNEL_DISCORD_*` entries ship with #4391.

## Implementation Plan

### Phase 1 — Operator guide

Follow the Gmail/IMAP guide structure: prerequisites → create the Discord application and bot →
privileged intents → invite the bot with the right scopes and permissions → connect the channel in
Open Mercato → Interactions Endpoint URL (`/api/channel_discord/interactions`) → run the gateway
worker → env presets → test → capability ceiling → troubleshooting → related links.

### Phase 2 — Developer guide

Two audiences on one page: (a) *consume* the hub from your own module — subscribe to
`communication_channels.message.received`, read the payload, send back through the generic outbound
path; (b) *build* a provider — the `ChannelAdapter` contract, capabilities as a contract (with
Discord's `false` flags and their reasons), fail-closed `verifyWebhook`, the gateway/queue pattern
for non-webhook transports, tenant-scoped state, health check, registration and packaging.

### Phase 3 — Cross-links, enumeration and navigation

### Phase 4 — Validation gate

Docs-only run: run the repo's docs build plus the advisory checkers that touch the changed files,
then re-read the diff.

## Risks

- **Merge ordering.** Documented above; called out in the PR body and summary comment.
- **Drifting from #4391.** #4391 has `CHANGES_REQUESTED`; a later revision could move a detail these
  pages state. Mitigated by sourcing every claim from code rather than prose, and by keeping the
  capability table close to `lib/capabilities.ts`.
- **Over-promising.** The spec over-promised `threading` / `fileSharing` / `interactiveComponents`
  once already. The capability table here is copied from the shipped file, not the spec.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Operator guide

- [x] 1.1 Write `apps/docs/docs/user-guide/communication-channels-discord.mdx` — a963a6687

### Phase 2: Developer guide

- [x] 2.1 Write `apps/docs/docs/framework/modules/building-communication-channel-provider.mdx` — 30ef40fde

### Phase 3: Cross-links and navigation

- [x] 3.1 Enumerate Discord and link the new pages from the hub + user-guide pages — 5b6554a40
- [x] 3.2 Add both pages (and the orphaned hub page) to `apps/docs/sidebars.ts` — 5b6554a40

### Phase 4: Validation

- [x] 4.1 Run the docs build and the advisory checkers; re-read the diff — 899828d13

Runner: **local** (no compose `app` container running; only `mercato-postgres` / `-redis` /
`-meilisearch`).

Gate for this docs-only run:

| Command | Result |
|---|---|
| `yarn build` (`apps/docs`, Docusaurus production build — validates every internal link) | ✅ pass |
| `node --test __tests__/search-index.test.mjs __tests__/reference-example-module.test.mjs` | ✅ 6/6 pass |
| Manual re-read of the diff | ✅ done — two factual errors found and fixed (899828d13) |

The build reports one broken anchor, `/installation/wsl2#connecting-wsl2-to-a-windows-hosted-database`.
It is **pre-existing** and untouched by this branch.

The remaining `validation.commands` entries (`build:packages`, `generate`, the i18n checkers,
`typecheck`, `test`, `build:app`) cover code surfaces this branch does not touch: the diff is eight
files, seven of them `.mdx`, plus `apps/docs/sidebars.ts`, which the Docusaurus build loads and
type-checks as part of the run above.

### Corrections found while re-reading the diff

- **Invite permission integers.** Drafted from the spec's `67648` / `75840`; the correct OR of
  `VIEW_CHANNEL` (0x400) + `SEND_MESSAGES` (0x800) + `READ_MESSAGE_HISTORY` (0x10000) +
  `ADD_REACTIONS` (0x40) is **68672**, and **76864** with `MANAGE_MESSAGES` (0x2000). The spec is
  wrong; the docs now carry the right numbers.
- **"Test send" button.** No such control exists — `test-send` is API-only. Replaced with the real
  request and its actual body schema (`to` / `subject?` / `body?`).
