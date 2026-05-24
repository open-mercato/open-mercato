# HIGH Findings Tracker

Source: [`report.md`](report.md) — generated 2026-05-06.
Total HIGH findings: **16**.

Status legend: `⬜ todo` · `🟡 in-progress` · `✅ fixed` · `🟢 verified` · `⏭️ skipped`

| # | Status | Title | File |
|---|--------|-------|------|
| 1 | ✅ fixed | Cross-user OpenCode session continuation enables privilege escalation | `packages/ai-assistant/src/modules/ai_assistant/lib/opencode-handlers.ts` |
| 2 | ✅ fixed | Cross-tenant write/delete on global `AttachmentPartition` via tenant-admin feature | `packages/core/src/modules/attachments/api/partitions/route.ts` |
| 3 | ✅ fixed | Cross-tenant role create/update/delete via body-supplied tenantId | `packages/core/src/modules/auth/api/roles/route.ts` |
| 4 | ✅ fixed | Hardcoded default password 'secret' for derived admin/employee users | `packages/core/src/modules/auth/lib/setup-app.ts` |
| 5 | ✅ fixed | Demo deactivation only handles superadmin@acme.com, leaves admin/employee active | `packages/core/src/modules/auth/lib/setup-app.ts` |
| 6 | ⬜ todo | Privilege escalation: writes gated by view-only feature | `packages/core/src/modules/currencies/api/fetch-configs/route.ts` |
| 7 | ⬜ todo | Hardcoded production fallback secret used to derive credential encryption keys | `packages/core/src/modules/integrations/lib/credentials-service.ts` |
| 8 | ⬜ todo | resetUserMfa allows tenant admin to reset MFA for users in any tenant | `packages/enterprise/src/modules/security/services/MfaAdminService.ts` |
| 9 | ⬜ todo | bulkComplianceCheck enumerates user emails from any tenant | `packages/enterprise/src/modules/security/services/MfaAdminService.ts` |
| 10 | ⬜ todo | createPolicy lets any admin create platform-wide or other-tenant MFA policies | `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts` |
| 11 | ⬜ todo | updatePolicy allows tenant admin to take over or escalate any policy by id | `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts` |
| 12 | ⬜ todo | deletePolicy soft-deletes any policy by id without tenant scope checks | `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts` |
| 13 | ⬜ todo | Cross-account MFA verification: challenge not bound to authenticated user | `packages/enterprise/src/modules/security/services/MfaVerificationService.ts` |
| 14 | ⬜ todo | Hardcoded fallback secret enables sudo token forgery if env vars unset | `packages/enterprise/src/modules/security/services/SudoChallengeService.ts` |
| 15 | ⬜ todo | User-controlled Ollama base URL can drive server-side requests | `packages/search/src/vector/services/embedding.ts` |
| 16 | ⬜ todo | Unauthenticated splash bootstrap token can authorize GitHub publish actions | `scripts/dev-splash-git-repo-flow.mjs` |

---

## 1. Cross-user OpenCode session continuation enables privilege escalation

- **Status:** ✅ fixed
- **PR / commit:** `dba38484d`
- **Notes:** Added `api_keys.opencode_session_id` (additive migration + partial unique index), bound to caller on `done` event, asserted owner `(userId, tenantId, organizationId)` on every resume in `handleOpenCodeMessage` / `handleOpenCodeMessageStreaming` / `handleOpenCodeAnswer`. Opaque error `'Session not available'` everywhere. Replaced unscoped `getPendingQuestions()` with owner-scoped `getOwnedPendingQuestions(em, auth)`; deprecated overload now throws to fail loudly. Tests: `apiKeyService.opencodeBinding.test.ts` (5 cases) + `opencode-handler-ownership.test.ts` (10 cases) + `chat-route-ownership.test.ts` (8 cases) + Playwright `TC-AI-CHAT-OWNERSHIP-001` (4 cases). Spec: `.ai/specs/2026-05-24-fix-opencode-session-ownership.md`. Local test runner blocked by pre-existing `TS5103` (jest `ignoreDeprecations: '6.0'` vs TS 5.9.3) — `build:packages` passes; CI must validate the test+typecheck legs. Deferred Low follow-ups: L1 uniform opaque message in `handleOpenCodeMessage`, L2 `as any` cast in `findApiKeyByOpencodeSessionId`, L4 separate finding: pre-existing `findApiKeyBySessionToken` uses raw `em.findOne` (file a new tracker entry).

- **File:** `packages/ai-assistant/src/modules/ai_assistant/lib/opencode-handlers.ts`
- **Lines:** 69, 70, 71, 72, 271, 272, 273, 274, 275, 658, 681, 682, 719, 720, 721
- **Slug:** cross-tenant-id · **Confidence:** high

handleOpenCodeMessage (L56-82), handleOpenCodeMessageStreaming (L246-642), and handleOpenCodeAnswer (L648-714) accept a user-supplied `sessionId` (and `questionId`) and call `client.getSession(sessionId)` / `client.answerQuestion(questionId, ...)` without verifying that the session/question belongs to the authenticated user. The calling chat route (`api/chat/route.ts:172-353`) only checks `requireFeatures: ['ai_assistant.view']` and does not validate session ownership either, while OpenCode itself is a generic AI agent with no concept of Open Mercato users.

Exploit chain: When user A starts a chat, the chat route generates a session token `sess_A` tied to user A's API key (route.ts:263-271) and injects it into the OpenCode conversation system instruction (`[Session Authorization: ${sessionToken}...]`). On follow-up messages, route.ts:254 only generates a new session token when `!sessionId`, so an existing OpenCode session keeps user A's `_sessionToken` baked into its conversation context. Once user B (any authenticated user with `ai_assistant.view`) sends a chat request with user A's `sessionId`, this handler resumes the OpenCode session — and the AI agent will continue calling MCP tools using `sess_A`, which the MCP server resolves to user A's ACL via `findApiKeyBySessionToken`. User B effectively executes API operations under user A's identity/roles (potential cross-tenant data access if the victim is in another tenant, and privilege escalation if A has higher permissions).

The `getPendingQuestions()` export at L719 also returns ALL pending questions across the entire OpenCode server (no session/user filtering), so any caller of the exported helper would receive other users' question text.

**Recommendation:** Persist a mapping (`tenant_id`, `organization_id`, `user_id`) → `opencodeSessionId` whenever a new session is created in the chat route, then in the handler accept an explicit auth context and reject when the lookup mismatches. Equivalently, store the OpenCode session id with the session API key row and require both to be presented (and bound to the authenticated user) before resuming. Also gate `getPendingQuestions()` by sessionId/user, and refuse to answer a `questionId` whose `sessionID` is not owned by the authenticated user.

---

## 2. Cross-tenant write/delete on global `AttachmentPartition` via tenant-admin feature

- **Status:** ✅ fixed
- **PR / commit:** `654528e02`
- **Notes:** Added nullable `attachment_partitions.tenant_id`/`organization_id` (additive migration + btree index, snapshot updated). POST stamps caller's tenant/org; GET filters to platform defaults (tenant_id IS NULL) OR own-tenant; PUT/DELETE gate on `(own-tenant) OR (platform-default AND superadmin)` and mask cross-tenant attempts as 404; DELETE in-use count is tenant-scoped. Every verb now also requires `auth.tenantId`. Migrated the four touched `em.findOne`/`em.find` calls on `AttachmentPartition` to `findOneWithDecryption`/`findWithDecryption`. Tests: `partitions.route.test.ts` (10 cases: cross-tenant PUT/DELETE blocked, own-tenant allowed, platform-default mutation gated by superadmin, GET visibility filter for tenant + superadmin, POST tenant stamping, DELETE in-use tenant scoping, unauth rejection on every verb, missing-tenantId rejection). Local test runner blocked by pre-existing `TS5103` (jest `ignoreDeprecations: '6.0'` vs TS 5.9.3) — same blocker as #1; `build:packages` passes, CI must validate the test+typecheck legs.

- **File:** `packages/core/src/modules/attachments/api/partitions/route.ts`
- **Lines:** 42, 43, 44, 45, 111, 133, 142, 143, 153, 171, 175, 178, 182
- **Slug:** acl-check · **Confidence:** high

`AttachmentPartition` is a global entity with no `tenant_id` / `organization_id` columns (entities.ts:5-42). The route is gated only by `requireFeatures: ['attachments.manage']`, and `attachments/setup.ts:5` grants `attachments.manage` to every tenant's `admin` role by default. The PUT handler (L111-151) loads the partition via `em.findOne(AttachmentPartition, { id: parsed.data.id })` with no tenant filter and rewrites `title`, `description`, `isPublic`, `requiresOcr`, `ocrModel`. The DELETE handler (L153-184) similarly removes any partition by id (subject only to a `DEFAULT_CODES` allowlist and a global usage check). Net effect: any tenant admin (Tenant A) can mutate or delete partitions created by Tenant B. Concrete impact includes (a) flipping `isPublic` on a private partition to expose attachments, (b) changing `ocrModel` to a model controlled by the attacker (cost / data-exfil to LLM), (c) deleting a custom partition Tenant B depends on (DoS once Tenant B has zero attachments referencing it, e.g. immediately after creation). Because `attachments.manage` is granted to a normal tenant role rather than a superadmin-only feature, every multi-tenant deployment is exposed.

**Recommendation:** Either (a) add `tenant_id` / `organization_id` columns to `AttachmentPartition` and scope every find / count by `auth.tenantId` and `auth.orgId` (matches the existing tenant-scoped `Attachment` model), or (b) move `attachments.manage` out of the default `admin` role and gate these handlers with `auth.isSuperAdmin === true` (acknowledging partitions as a platform-level resource). If choosing (a), also scope the `em.count(Attachment, ...)` usage check at L178 by tenant.

---

## 3. Cross-tenant role create/update/delete via body-supplied tenantId

- **Status:** ✅ fixed
- **PR / commit:** `0db55d9b2`
- **Notes:** Extended `enforceRoleTenantAccess` (in `packages/core/src/modules/auth/lib/roleTenantGuard.ts`) with a `'delete'` mode (additive union widening) and wired the helper into POST/PUT/DELETE `mapInput` callbacks on the roles route — rejects body.tenantId != auth.tenantId for non-superadmins with 403. Added command-layer defense-in-depth via `resolveActorScope` + `buildScopedRoleFilter` in `commands/roles.ts`: `auth.roles.update`/`auth.roles.delete` lookups now tenant-scope the existence filter for non-superadmins (404 on cross-tenant), `auth.roles.update` rejects tenant reassignment for non-superadmins (403), `auth.roles.create` anchors to `auth.tenantId`. Migrated the touched `em.findOne` to `findOneWithDecryption`. Tests: `roleTenantGuard.test.ts` (7 new delete-mode cases) + `roles.tenant-move.test.ts` (updated non-superadmin 403 contract + new create/delete tenant-scoping cases) + `roles.route.test.ts` (8 new mapInput-wiring tests). Local typecheck/jest blocked by pre-existing TS5103 (same as #1, #2); `build:packages` + `generate` + `i18n:check-sync` pass. Code-review: 0 Medium+, 2 Low (deferred — passthrough schema hardening; align delete 403→404 with command-layer 404). Deferred sibling finding: `packages/core/src/modules/auth/api/users/route.ts` uses the same passthrough+mapInput pattern and likely has an analogous cross-tenant `User.tenantId` vulnerability — file a new tracker entry.

- **File:** `packages/core/src/modules/auth/api/roles/route.ts`
- **Lines:** 65, 68, 83, 90, 237, 238, 239
- **Slug:** cross-tenant-id · **Confidence:** high

The POST/PUT/DELETE handlers are wired through makeCrudRoute with `rawBodySchema = z.object({}).passthrough()` (line 65) and `mapInput: ({ parsed }) => parsed` (lines 83, 90), forwarding the entire request body unchanged to the auth.roles.create/update/delete commands. The route never validates that body.tenantId matches auth.tenantId or that the actor is a superadmin. The downstream commands in packages/core/src/modules/auth/commands/roles.ts trust the body: createRoleCommand uses `parsed.tenantId ?? ctx.auth?.tenantId` (line 112) — body wins; updateRoleCommand looks up the existing role with `findOneWithDecryption(... { tenantId: null, organizationId: null })` (line 226) and then assigns `entity.tenantId = parsed.tenantId` (line 244), allowing tenant reassignment of any role; deleteRoleCommand looks up with the same null-scoped filter (line 380) and deletes without a tenant check. Result: any tenant admin holding `auth.roles.manage` (which the seed grants admin via `auth.*` wildcard) can (a) create roles in foreign tenants by sending `{ name, tenantId: <other-tenant> }`, (b) reassign or rename roles in any tenant by guessing/learning their UUIDs, and (c) delete roles in any tenant — potentially locking out users in foreign tenants. The route's GET filter (lines 150-155) hides this from list responses, making the abuse stealthy. The fix belongs at the route boundary or in the command: reject body.tenantId when it differs from auth.tenantId unless the resolved RBAC says isSuperAdmin, and scope existing-role lookups by auth.tenantId for non-superadmins.

**Recommendation:** Either (a) replace `rawBodySchema` with a strict schema that omits `tenantId` and inject it from auth context inside `mapInput`, falling back to a superadmin-gated override; or (b) add an explicit guard in mapInput/before delegating to commands: `if (body.tenantId && body.tenantId !== auth.tenantId && !isSuperAdmin) throw 403`. Apply the same guard to update/delete (delete must look up the role scoped by auth.tenantId for non-superadmins). Regression tests should cover all three verbs sending a foreign tenantId.

---

## 4. Hardcoded default password 'secret' for derived admin/employee users

- **Status:** ✅ fixed
- **PR / commit:** `12af0a98e`
- **Notes:** Removed literal `'secret'` fallback from `setup-app.ts` derived-user block; random `randomBytes(12).toString('base64url')` (96 bits entropy) password generated when env overrides are unset, surfaced via new optional `users[].generatedPassword` snapshot. Added `DerivedUserPasswordRequiredError` + production safeguard (`NODE_ENV=production` + missing env vars + no `allowDemoDerivedPasswords` opt-in → throw before any DB writes). New `--include-demo-users` CLI flag flips `mercato auth setup` to default-deny (derived `admin@`/`employee@` accounts are no longer silently seeded); `mercato init` passes the flag explicitly so the dev/demo bootstrap path is unchanged. CLI output now prints generated passwords with a "GENERATED — copy now" warning. `OM_INIT_GENERATE_RANDOM_PASSWORD` becomes a deprecated no-op with a one-time warning. Tests: new `cli-setup-demo-users.test.ts` (4 cases: default no-seed, opt-in random, opt-in env-supplied, production safeguard throw) + rewritten `init-secrets.test.ts` (no `'secret'` default, base64url randomization, deprecated toggle is no-op). Local jest/typecheck blocked by the pre-existing `TS5103` and `re2js` issues (same as #1, #2, #3); `build:packages` + `generate` + `i18n:check-sync` + `i18n:check-usage` pass. Code-review: 0 Medium+, 2 Low (deferred — top-level vs dynamic import in the new test; `RELEASE_NOTES.md` entry for the CLI default flip). Sibling finding #5 (`deactivateDemoSuperAdminIfSelfOnboardingEnabled` only neutralizes `superadmin@acme.com`) is out of scope here and tracked separately. BC: additive type changes only (`allowDemoDerivedPasswords?`, `generatedPassword?`); CLI default flip is the security fix itself — must be documented in release notes.

- **File:** `packages/core/src/modules/auth/lib/setup-app.ts`
- **Lines:** 184, 185, 186, 187, 188, 189, 190, 191, 192, 193
- **Slug:** secret-in-fallback · **Confidence:** high

When `setupInitialTenant` runs with `includeDerivedUsers: true` (the default and the value used by `mercato auth setup`), the derived `admin@acme.com` and `employee@acme.com` users are created with password `'secret'` whenever the `OM_INIT_ADMIN_PASSWORD` / `OM_INIT_EMPLOYEE_PASSWORD` env vars are unset (`readEnvValue('OM_INIT_ADMIN_PASSWORD') || 'secret'`). Critically, the CLI prints the password only for the primary user (cli.ts ~L458–468) and just emits `Created user admin@acme.com` for the derived ones, so an operator running setup in production has no indication that two privileged accounts (`admin` role and `employee` role) now exist with the well-known default `secret`. The accounts are also marked confirmed (`confirm` defaults to true at L287), so they are immediately usable for login. Combined with the deactivation gap below, this means a production deployment that bootstraps via the setup CLI without setting these env vars exposes guessable admin credentials at known emails.

**Recommendation:** Refuse to seed derived users when no explicit password (and `--with-demo` style opt-in flag) is supplied: throw if the env vars are missing in production, or require an additional `--include-demo-users` flag that prints a loud warning and the credentials. At minimum, treat unset env vars as a hard error rather than defaulting to a publicly known string, and ensure the CLI surfaces the password it actually used for every created user.

---

## 5. Demo deactivation only handles superadmin@acme.com, leaves admin/employee active

- **Status:** ✅ fixed
- **PR / commit:** `1e61a03d1`
- **Notes:** Introduced pure `resolveDemoUserEmails()` helper that returns the canonical `[{superadmin, admin, employee}]` list honoring the same `OM_INIT_ADMIN_EMAIL`/`OM_INIT_EMPLOYEE_EMAIL` env overrides as the seeding path; rewrote `deactivateDemoSuperAdminIfSelfOnboardingEnabled` → `deactivateDemoUsersIfSelfOnboardingEnabled` as a per-user `try/catch` loop so one failed lookup never skips the other accounts; kept old name as a private `@deprecated` `const` alias (helper was never exported — verified by `grep`, BC-safe). `shouldKeepDemoSuperadminDuringInit()` semantics preserved as-is (gates the whole loop, not just superadmin). Tests: new `cli-deactivate-demo-users.test.ts` (11 cases — all-three neutralization, env-override resolution, onboarding-off no-op, keep-demo-init gate honored for all three, per-user error isolation, missing-row skip, idempotence, resolver edge cases including whitespace-only env values). All 34 auth tests pass via repo-root `yarn jest`. `build:packages` + `generate` + `i18n:check-sync` pass; pre-existing `TS5103` and missing-`re2js` blockers (same as #1–4) bring down `typecheck` / `test` / `build:app` for unrelated packages — CI must validate those legs. Code-review: 0 Medium+, 2 Low (deferred — vestigial private alias documents the rename; `any` on test EM mock matches the established auth-test pattern).

- **File:** `packages/core/src/modules/auth/lib/setup-app.ts`
- **Lines:** 537–558
- **Slug:** auth-bypass · **Confidence:** high

`deactivateDemoSuperAdminIfSelfOnboardingEnabled` only looks up `DEMO_SUPERADMIN_EMAIL = 'superadmin@acme.com'` and clears that user's `passwordHash`/`isConfirmed`. The same setup flow seeds `admin@acme.com` and `employee@acme.com` (see L184–194) — and per the finding above, those accounts default to password `'secret'`. When an operator enables `SELF_SERVICE_ONBOARDING_ENABLED=true` they likely expect demo accounts to be neutralized, but the helper silently leaves the admin- and employee-role demo users intact, with full access to their respective ACL features. This is exactly the kind of gap that lets attackers retain footholds via stale demo identities after the operator believed the demo path was disabled.

**Recommendation:** Extend the deactivation helper to cover every email seeded by the derived-user path (admin@<domain>, employee@<domain>, and any env-overridden equivalents), or invert the design: seed derived users only when an explicit demo flag is set, and never leave them behind in non-demo deployments.

---

## 6. Privilege escalation: writes gated by view-only feature

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/core/src/modules/currencies/api/fetch-configs/route.ts`
- **Lines:** 15, 16, 17, 18, 52, 84, 122
- **Slug:** acl-check · **Confidence:** high

The route exports `metadata = { requireAuth: true, requireFeatures: ['currencies.fetch.view'] }` at the top level (line 15-18). The dispatcher's `extractMethodMetadata` (in `apps/mercato/src/app/api/[...slug]/route.ts`) only honors method-keyed entries (`{ POST: {...} }`); for a flat metadata object it applies the same `requireFeatures` to every HTTP method. As a result, the POST/PUT/DELETE handlers are gated only by the read permission `currencies.fetch.view`, while the dedicated write permission `currencies.fetch.manage` (declared in `packages/core/src/modules/currencies/acl.ts`) is never enforced. None of the inline handler code adds an additional feature check — only `auth`, `auth.tenantId`, and `auth.orgId` are asserted. A user with view-only permission on currency fetch configuration can therefore create, update, and delete fetch configs, including saving `Custom` provider configs whose `config` JSON is unconstrained (`z.record(z.string(), z.unknown())`). The sister route `packages/core/src/modules/currencies/api/fetch-rates/route.ts` correctly uses `currencies.fetch.manage` for its POST, confirming the intended split.

**Recommendation:** Switch to method-keyed metadata so write methods require the manage feature, e.g. `export const metadata = { GET: { requireAuth: true, requireFeatures: ['currencies.fetch.view'] }, POST: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] }, PUT: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] }, DELETE: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] } }`. Alternatively, add an explicit `rbacService.userHasAllFeatures(auth.sub, ['currencies.fetch.manage'], { tenantId, organizationId })` check inside POST/PUT/DELETE handlers.

---

## 7. Hardcoded production fallback secret used to derive credential encryption keys

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/core/src/modules/integrations/lib/credentials-service.ts`
- **Lines:** 33, 34, 35, 36, 90
- **Slug:** secret-in-fallback · **Confidence:** high

When all of TENANT_DATA_ENCRYPTION_FALLBACK_KEY, TENANT_DATA_ENCRYPTION_KEY, AUTH_SECRET, and NEXTAUTH_SECRET are missing in production, resolveFallbackEncryptionSecret() falls back to the hardcoded literal 'om-emergency-fallback-rotate-me' (line 36). resolveCredentialsDek() invokes deriveDekFromSecret() with this value when the KMS layer returns null (e.g., when tenant data encryption is disabled or Hashicorp Vault is misconfigured and the KMS resolves to NoopKmsService). The shared KMS module (packages/shared/src/lib/encryption/kms.ts:113) is explicitly designed to NOT use a hardcoded production fallback — resolveDerivedKeySecret() returns null in production rather than emit a hardcoded value, forcing createKmsService() to return NoopKmsService. credentials-service.ts breaks this safeguard by introducing its own production fallback. Because the literal is committed to an open-source repository, an attacker who obtains an encrypted backup of integration_credentials and the tenant_id (also stored alongside) can deterministically derive the DEK and decrypt all integration credentials (third-party API keys, OAuth secrets, webhook signing keys) for any tenant via SHA-256('integrations.credentials:' + tenantId + ':om-emergency-fallback-rotate-me'). A single missed env var in production silently downgrades integration-credential encryption to effectively-plaintext while console.warn fires only once at runtime — easy to miss in centralized logs. The console.warn message says 'using emergency fallback secret' but does NOT throw or refuse; the system keeps writing data with a public key.

**Recommendation:** Remove the hardcoded production fallback. Mirror the KMS contract: when production env vars are missing, throw or return null and surface the error to callers so credential save/get fails closed instead of silently using a known-public key. If a non-Vault path is needed, require a real secret from a configured source (env, file, or KMS) and abort otherwise. Additionally, consider delegating to the existing DerivedKmsService (PBKDF2 310k SHA-512) instead of duplicating fallback resolution here, so the credentials path inherits the same security properties as the rest of the platform.

---

## 8. resetUserMfa allows tenant admin to reset MFA for users in any tenant

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaAdminService.ts`
- **Lines:** 46–96, 189–191
- **Slug:** cross-tenant-id · **Confidence:** high

resetUserMfa(adminId, userId, reason) (lines 46-96) loads the target user via findUserById (lines 189-191), which is `em.findOne(User, { id: userId, deletedAt: null })` — no tenant filter and no comparison against the calling admin's tenantId/orgId. The route api/users/[id]/mfa/reset/route.ts is gated only by `requireFeatures: ['security.admin.manage']`. setup.ts grants `security.*` (which includes security.admin.manage) to BOTH 'superadmin' AND 'admin' roles. The 'admin' role is per-tenant. Therefore any tenant admin can POST to /api/security/users/{victimUserId}/mfa/reset for a userId belonging to a DIFFERENT tenant, bypass their MFA, and (combined with stolen-credentials or social-engineering) take over accounts cross-tenant. The route does require sudo for the target identifier 'security.admin.mfa.reset', but sudo just confirms the caller's identity — it does not constrain WHICH user can be targeted. Compare against SudoChallengeService.assertWriteScope (lines 528-548) which is correctly applied to sudo-config writes.

**Recommendation:** Accept a SudoAuthScope (or auth context) and verify user.tenantId === scope.tenantId (and orgId where applicable) unless scope.isSuperAdmin. Fail with 404 to avoid revealing existence of cross-tenant users. Also add an integration test analogous to SudoChallengeService's 'rejects attempts to target a foreign tenant' tests.

---

## 9. bulkComplianceCheck enumerates user emails from any tenant

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaAdminService.ts`
- **Lines:** 139–187
- **Slug:** cross-tenant-id · **Confidence:** high

bulkComplianceCheck(tenantId) (lines 139-187) uses the tenantId argument directly in the user query (line 144-155) without comparing against the admin's actual tenantId. The route api/users/mfa/compliance/route.ts (line 40) reads the tenantId from the optional `?tenantId=` query string and falls back to context.auth.tenantId. Because security.admin.manage is granted to per-tenant 'admin' roles, a tenant admin can call `GET /api/security/users/mfa/compliance?tenantId=<other-tenant-uuid>` and receive a list of every user in that other tenant including their plaintext email addresses (decrypted via findWithDecryption at line 144). This is cross-tenant PII enumeration.

**Recommendation:** Require a SudoAuthScope/auth parameter; if scope.isSuperAdmin === false, force tenantId := scope.tenantId and ignore caller-supplied overrides. Reject explicit tenantId mismatches with 403/404. Update the route to stop accepting an arbitrary tenantId query param from non-superadmins.

---

## 10. createPolicy lets any admin create platform-wide or other-tenant MFA policies

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts`
- **Lines:** 123–173
- **Slug:** cross-tenant-id · **Confidence:** high

createPolicy(data, adminId) (lines 123-173) takes the entire validated input — including data.scope, data.tenantId, data.organizationId — and persists a MfaEnforcementPolicy without any check that the calling admin owns that scope. The corresponding route api/enforcement/route.ts is gated only by `requireFeatures: ['security.admin.manage']`, which setup.ts grants to the per-tenant 'admin' role via the `security.*` wildcard. A tenant admin can therefore POST `{ scope: 'platform', isEnforced: false }` and disable MFA enforcement for every user across every tenant, or POST `{ scope: 'tenant', tenantId: '<other-tenant-uuid>', isEnforced: true, allowedMethods: ['email_otp'] }` to lock another tenant's users into a specific (or no) MFA method. This is a cross-tenant privilege escalation that can also escalate to platform-level. normalizePolicyInput (lines 344-403) only structurally validates the input; it does not compare against the admin's actual scope.

**Recommendation:** Accept an AdminScope ({ tenantId, organizationId, isSuperAdmin }) parameter and validate: (a) non-superadmin cannot create scope=PLATFORM; (b) non-superadmin must use scope=TENANT/ORGANISATION with tenantId === scope.tenantId; (c) reject with 403/404. Mirror the pattern in SudoChallengeService.createConfig + assertWriteScope.

---

## 11. updatePolicy allows tenant admin to take over or escalate any policy by id

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts`
- **Lines:** 175–232
- **Slug:** cross-tenant-id · **Confidence:** high

updatePolicy(id, data, adminId) (lines 175-232) loads the policy by id alone (line 180-183), then merges request data into it. Crucially, the merged input also accepts data.scope and data.tenantId/organizationId, so a tenant admin can call `PUT /api/security/enforcement/<any-policy-id>` with `{ scope: 'platform' }` to convert another tenant's TENANT-scoped policy into a PLATFORM-scoped one (or vice versa) and/or change tenantId to any other tenant's UUID. There is no comparison between policy.tenantId/scope and the calling admin's tenantId, and no check that scope changes are allowed for non-superadmins.

**Recommendation:** Require an AdminScope parameter; before merging, verify policy.tenantId === scope.tenantId (and orgId where applicable) for non-superadmins; reject scope/tenant changes that move a policy out of the admin's scope; return 404 to avoid leaking existence.

---

## 12. deletePolicy soft-deletes any policy by id without tenant scope checks

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaEnforcementService.ts`
- **Lines:** 234–247
- **Slug:** cross-tenant-id · **Confidence:** high

deletePolicy(id) (lines 234-247) takes only the id, with no admin/scope parameter. The command in commands/deleteEnforcementPolicy.ts forwards directly. A tenant admin (who has `security.admin.manage` because admin role gets `security.*`) can DELETE /api/security/enforcement/<any-policy-id> for a policy in any other tenant or even the PLATFORM-scope policy, soft-deleting it and effectively turning off MFA enforcement for those scopes.

**Recommendation:** Add an AdminScope parameter and verify policy.scope/tenantId before soft-deleting, matching the assertWriteScope pattern; for non-superadmins, reject deletion of PLATFORM scope and of policies belonging to other tenants.

---

## 13. Cross-account MFA verification: challenge not bound to authenticated user

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/MfaVerificationService.ts`
- **Lines:** 89, 95, 117, 138, 142, 175, 176
- **Slug:** auth-bypass · **Confidence:** high

`getValidChallenge(challengeId)` (line 176) looks up the MfaChallenge solely by `id`, with no check that `challenge.userId === auth.sub`. The verify route (`api/mfa/verify/route.ts`) takes `challengeId` from the request body and passes it through unchecked. `verifyChallenge` (line 142) then calls `provider.verify(challenge.userId, ...)` using the *challenge owner's* identity to authenticate the payload, while the route afterwards issues an `mfa_verified` JWT for `context.auth.sub` (the *caller's* identity). Attack: an attacker with a known password for victim A (one factor) and any other MFA-enrolled account B (e.g. their own dummy account) can: (1) log in as B and call `createChallenge` to obtain B's challengeId, (2) log in as A to obtain an `mfa_pending` token for A, (3) POST to `/api/security/mfa/verify` with A's auth cookie but B's `challengeId` and a valid TOTP/payload for B. The service authenticates B's payload against B's secret (succeeds), marks B's challenge verified, and the route issues an MFA-verified token for A — granting full access to A without ever exercising A's second factor. This is a complete MFA bypass given knowledge of the password and possession of any second-factor-enrolled account in the same system.

**Recommendation:** Require the caller to pass the authenticated `userId` into `prepareChallenge`/`verifyChallenge`, and either filter `getValidChallenge` by `{ id, userId }` or assert `challenge.userId === auth.sub` immediately after lookup (throw 404 on mismatch to avoid enumeration). Apply the same binding in `prepareChallenge`. Alternatively, derive `auth.sub` inside the route and pass it to the service as a required parameter.

---

## 14. Hardcoded fallback secret enables sudo token forgery if env vars unset

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/enterprise/src/modules/security/services/SudoChallengeService.ts`
- **Lines:** 676–681
- **Slug:** secret-in-fallback · **Confidence:** high

getSudoSecret() (lines 676-681) silently falls back to the literal string 'open-mercato-sudo-secret' when none of OM_SECURITY_SUDO_SECRET, AUTH_JWT_SECRET, or JWT_SECRET are configured. The HMAC-SHA256 signature for sudo step-up tokens (signToken at line 651-655) and verification (readSignedToken at line 657-674) both consume this secret. If a deployment forgets to set any of these variables, every sudo token is signed with a publicly knowable constant and an attacker can forge tokens. This is inconsistent with readSecuritySetupTokenSecret() in lib/security-config.ts (lines 173-186) which throws when no secret is configured. Although validateToken (line 320-326) currently performs an additional DB lookup that requires sessionToken to match an existing SudoSession row (so direct offline forgery is blocked today), this is brittle defense-in-depth: any future refactor that drops the DB lookup, any token-replay/audit cache that trusts the signature alone, or any background task that uses readSignedToken in isolation immediately becomes a full sudo-bypass. Sudo tokens gate sensitive operations such as security.admin.mfa.reset and security.sudo.manage.

**Recommendation:** Mirror readSecuritySetupTokenSecret(): throw if none of the env vars are set rather than returning a hardcoded literal. Optionally, fail fast at module construction time so misconfigured deployments can't even boot.

---

## 15. User-controlled Ollama base URL can drive server-side requests

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `packages/search/src/vector/services/embedding.ts`
- **Lines:** 98, 159
- **Slug:** ssrf · **Confidence:** high

EmbeddingService builds the Ollama client from this.config.baseUrl without validating scheme, host, or address range. The search embeddings settings API accepts embeddingConfig.baseUrl as a plain optional string and treats the Ollama provider as configured even without an environment URL, so a user with search.embeddings.manage can persist an arbitrary internal URL and then trigger embedding creation through search or vector reindexing. That causes the application server to send embedding requests, including indexed/search text, to attacker-chosen hosts such as localhost, link-local metadata services, or private network services.

**Recommendation:** Do not accept arbitrary persisted baseUrl values. Prefer an environment-only Ollama URL, or validate with URL parsing plus an explicit allowlist and block loopback, link-local, RFC1918, and non-http(s) destinations unless deliberately allowed by deployment policy.

---

## 16. Unauthenticated splash bootstrap token can authorize GitHub publish actions

- **Status:** ⬜ todo
- **PR / commit:** _TBD_
- **Notes:** _TBD_

- **File:** `scripts/dev-splash-git-repo-flow.mjs`
- **Lines:** 537, 543, 556, 560, 622, 734, 830
- **Slug:** auth-bypass · **Confidence:** high

The GitHub publish endpoint only checks x-om-dev-splash-token, while getBootstrapPayload exposes that token to any client that can load the splash page. Once obtained, the token authorizes a POST that can run git add -A, create an initial commit, and execute gh repo create --source . --remote origin --push using the developer's authenticated GitHub CLI; the request can also select public visibility. With DNS rebinding against the local splash port or any exposed container/dev splash server, an attacker could cause the current project to be pushed to a GitHub repository under the developer's account or org, potentially exposing source code and local files staged by git add -A.

**Recommendation:** Add Host and Origin validation at the splash HTTP server and action handlers, reject requests whose Host is not localhost/127.0.0.1/[::1], avoid binding mutation-capable splash endpoints to 0.0.0.0 by default, and require explicit local confirmation before running git/gh publishing commands. Treat the bootstrap token as CSRF defense only after the bootstrap itself is protected from DNS rebinding and network exposure.
