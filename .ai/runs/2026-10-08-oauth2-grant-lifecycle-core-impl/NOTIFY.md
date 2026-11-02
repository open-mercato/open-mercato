# Notify — 2026-10-08-oauth2-grant-lifecycle-core-impl

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-08T11:01:48Z — run started
- Brief: implement the spec at `.ai/specs/2026-10-01-oauth2-grant-lifecycle-core.md` (PR #6910, `9f23ede6c`) as a draft PR.
- External skill URLs: none
- Decision: the slug is `oauth2-grant-lifecycle-core-impl`, because `feat/oauth2-grant-lifecycle-core` is the spec PR's branch.
- Decision: this invocation lands Steps 1.1–2.2 and pauses before Step 3.1 until App Spec Q3 has a signal; the PR stays a draft.
- Decision: the spec files are read from the PR #6910 branch and are not committed here.

## 2026-10-08T12:21:23Z — checkpoint 1 (Steps 1.1..2.2)
- Steps 1.1 `7bcbf9d0f`, 1.2 `68caa78ff`, 2.1 `0913bbe3a`, 2.2 `f77228974`; each Step was dispatched to one executor subagent (1.1 and 2.1 at the capable tier, 1.2 and 2.2 at the standard tier).
- Targeted validation passed: build:packages, shared and core typecheck, shared db and integrations tests, the real-Postgres lock suite, eslint, agents budget (`checkpoint-1-checks.md`).
- Decision: each Step's commit sets its own row to `done` with `pending` and back-fills the previous row's SHA; the checkpoint commit back-fills the last one, so every recorded SHA resolves on the remote.
- Decision: the run pauses before Step 3.1 until App Spec Q3 has a signal; the PR stays a draft.
- Note for Q3: A1 cannot detect a missing `cloneEventManager` (subscribers still fire through the shared event manager); `revokeToken` accepts only status 200, as the spec states.

## 2026-10-12T09:14:54Z — surface trim and single commit
- Decision: the public surface is what a provider module needs; `createIntegrationOAuthGrantService`, `IntegrationOAuthGrantServiceDeps`, `requestTokenEndpoint`, `revokeToken`, `OAUTH_RESPONSE_MAX_BYTES`, `OAuthClientCredentials`, `oauthProviderDescriptorSchema`, `resolveOAuthProviderDescriptor`, `eraseIntegrationCredentials` and `findLatestIntegrationLogsByCodes` are `@internal`; the lock-key mapping `hashtextextended(key, 0)` and the holder-slot registry on `globalThis` are frozen formats (both specs, 2026-10-12 changelog).
- Decision: spec corrections land in this PR together with the code.
- Decision: the draft keeps one commit on `develop` @ `a15774dd1`; Steps 1.1–2.2 are recorded as `squashed`.

## 2026-10-12T10:11:45Z — om-auto-continue-pr-loop resume
- Resumed by: @mikolajbogusz-they
- Resume point: 3.1 (source: HANDOFF.md and the Tasks table; Steps 1.1–2.2 are `squashed` into the branch's single commit)
- PR head SHA: 93cd53e42
- Decision: local-only run — no tracker writes; Steps commit locally and are squashed into the draft's single commit before any push.
- Decision: App Spec Q3 is treated as approved with the 2026-10-12 surface; rework if maintainers trim further is accepted.

## 2026-10-12T12:08:09Z — checkpoint 2 (Steps 3.1..4.4)
- Steps 3.1–4.4 landed as local commits, one executor subagent each at the capable tier; targeted validation passed (`checkpoint-2-checks.md`).
- Decision: `readCredentialRowLayered` asks the KMS with `getTenantDek` only, so a read never creates a tenant key; no key gives `no_dek('no-dek')`.
- Decision: the test route checks flag, auth, tenant, body, integration id, organization and `integrations.credentials.manage` before the mutation guards; its `connect` uses the fake server's own origin for the redirect URI.
- Decision: A40 holds and releases token responses inside the test, so `FakeInjection` keeps its contract.
- Decision: report codes the spec leaves open: `oauth_refresh_transient` for token-endpoint transients, `integrations.oauth_refresh_failed` for other refresh failures, `oauth_platform_unavailable` for unreadable grants, `oauth_inspect_failed` only for thrown errors; `invalid_grant` is recorded by its log entry, not reported.
- Decision: `oauth_external_account_selected` carries `{ providerDataKeys, actorUserId }`; `readGrantStatus` checks existence with a local count over `buildCredentialsFilter`.
- Problem (platform, outside this PR): a lock holder whose session Postgres ends (25P03) loses its pooled connection, because the Kysely rollback fails; the test harness frees those connections on close.
- To settle in the review: an `active` grant without a Client Configuration maps to `oauth.connected` (App Spec §1.4.4 precedence covers only `connectionState: 'unavailable'`); A24's "not queryable" error appears on the holder's next statement.

## 2026-10-12T12:46:43Z — checkpoint 3 (Step 4.5)
- Step 4.5 landed (one capable-tier executor); targeted validation passed (`checkpoint-3-checks.md`). Phase 4 is closed.
- Decision: disconnect `failureReason` also carries the endpoint error kind when the provider sends no `error`, `client_not_configured`/`platform_unavailable` for an unusable Client Configuration at revoke time, and `cleanup_failed` for an unexpected post-release error; when hook and revoke both fail the revoke's code wins and `hookFailed` is added; without a captured refresh token the access token is revoked with `token_type_hint=access_token`.

## 2026-10-12T13:55:24Z — Step 5.1-review-fix
- Problem: `yarn build:app` failed in Next's type pass: the app resolves `node:http` types from a second `@types/node` copy, and the fake server (imported at runtime by the test route since Step 4.2) passed `IncomingMessage`/`ServerResponse` between the two. Fix: the fake's handlers take structural request and response types.
- Problem: in the production build `instanceof OAuthGrantError` failed after the first backend page rendered (the DI-resolved grant service and the route load separate copies of the class), so a refresh ending in `grant_invalidated` answered 500. Fix: the four error classes carry non-enumerable `Symbol.for` brands and `static [Symbol.hasInstance]`; the brand keys are frozen (feature spec, Migration & Backward Compatibility).

## 2026-10-12T15:12:48Z — final gate and resume end
- All Steps done; Steps squashed into one commit on `develop` @ `3b2bb92d4`; final gate passed (`final-gate-checks.md`).
- Decision: `packages/create-app/agentic/shared/ai/harness/cases.json` raises the five cases that include `BACKWARD_COMPATIBILITY.md` to the next 4 KiB step, because the new BC section grew the file.
- Status: complete; the PR stays a draft until maintainers settle App Spec Q3 and Q7; no tracker writes in this run (drafts prepared for the user).
