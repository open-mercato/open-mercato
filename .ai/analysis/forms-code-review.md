# forms → core — code review of `cez/c82a4a14`

**Verdict: REQUEST CHANGES**

Two HIGH functional regressions were introduced by the branch's own security hardening, and one
command in the configured validation gate now fails. Everything else in the delta — including five
of the nine items the order asked me to be sceptical about — checks out, and I say so explicitly in
§ What checks out.

Both HIGH findings are the same shape: `getCurrent`'s new unconditional slicing is correct at the
public API boundary, but two *internal* callers were passing no role precisely because they wanted
the full payload, and neither was updated. Neither is covered by a test, so the entire core suite
(2064 suites, 18898 tests) stays green over both.

- Reviewed: `cez/c82a4a14` @ `1003128b2`, fork point `12f434927`
- Vendor baseline: `d280fb625` (`chore(forms): vendor the official forms module source into core (WIP)`)
- Spec: `.ai/specs/2026-09-30-forms-module-into-core.md`

All nine findings were re-checked against the branch tip at the time of writing, `8ba5f7b17` (four
commits past the reviewed revision: `createLogger` routing, a QA category code, two run-plan doc
edits). **All nine still stand there** — none of those commits touch `di.ts`,
`distribution-service.ts`, the sentinel, the missing locale keys, the lock markers, the duplicated
interceptor arms, the coverage guard, or the purge worker's pagination.

---

## How the real delta was isolated

The diff vs the fork point is 327 files / 70416 insertions, but ~58k of that is the verbatim vendor
of `open-mercato/official-modules@d694a75`. The actual new work is two disjoint sets:

```bash
# (1) everything the branch touches OUTSIDE the vendored directory — 21 files, 4912 insertions
git diff --stat 12f434927..HEAD -- . ':(exclude)packages/core/src/modules/forms'

# (2) the branch's delta from the vendored source — 58 files, 1547 insertions / 176 deletions
git diff --stat d280fb625..HEAD -- packages/core/src/modules/forms
```

`services/submission-service.ts` reports as `Bin 39198 -> 40888 bytes` in (2) and therefore does not
appear in any textual diff. That is itself a finding (**F3**). To review it I reconstructed the diff
by hand:

```bash
git cat-file -p d280fb625:packages/core/src/modules/forms/services/submission-service.ts > /tmp/ss-old.ts
LC_ALL=C sed 's/\x00/<NUL>/g' packages/core/src/modules/forms/services/submission-service.ts > /tmp/ss-new.ts
diff -u /tmp/ss-old.ts /tmp/ss-new.ts
```

It contains exactly three hunks: the `NO_ROLE_SENTINEL` constant, the `submit()` actor check, and the
unconditional slicing in `getCurrent`.

---

## Findings

### F1 — HIGH — GDPR consent projection silently stops working

`packages/core/src/modules/forms/di.ts:161`
`packages/core/src/modules/forms/services/consent-record-service.ts:103`

`formsConsentRecordService`'s `loadSubmission` calls `getCurrent` with no `viewerRole`. The comment
ten lines above it says so on purpose:

```
di.ts:151  // Phase 3 Track D — projects signed `signature` answers into the
di.ts:152  // `forms_consent_record` per-subject consent aggregate. Loads the
di.ts:153  // submission via the submission service (admin/full read, no role slice)
di.ts:154  // so signature answers are present, then upserts + supersedes.
```

```ts
di.ts:161            const view = await formsSubmissionService.getCurrent({
di.ts:162              submissionId,
di.ts:163              organizationId,
di.ts:164              tenantId,
di.ts:165            })
```

**Why it is wrong.** After the change, `submission-service.ts:899` resolves the absent role to
`NO_ROLE_SENTINEL`. `RolePolicyService.computeVisibleFieldKeys` (`services/role-policy-service.ts:54-62`)
matches with `descriptor.visibleTo.includes(role)`, no field declares the sentinel, so the visible
set is empty and `slicePayload` returns `{}`. `resolveVisibleFieldKeys` returns an empty set too
(`services/visibility-resolver.ts:40`, `if (!policy.canRead) continue`). So `view.decodedData` is
always `{}`, and at `consent-record-service.ts:103`:

```ts
const signature = readSignatureValue(decodedData[consentFieldKey])
if (!signature) continue
```

every signature field is skipped and `projectSubmission` always returns `[]`. No throw, no log. Every
signed consent stops being written to `forms_consent_record`, so the consents API
(`api/subjects/[subjectType]/[subjectId]/consents/route.ts`) and the supersede chain go permanently
empty. The di.ts comment is now false.

**Why no test caught it.** `__tests__/consent-record-service.test.ts:120` stubs
`loadSubmission: async () => load`, so the service is tested in isolation from the di.ts wiring that
regressed. Confirmed: `cd packages/core && yarn jest` → 2064 suites passed.

**Minimal fix.** Add an explicit, opt-in unsliced read for trusted server-side callers and use it
here — e.g. a `viewerRole?: string | null` companion flag `unsliced?: true` on `GetCurrentArgs`, or a
separate `getCurrentUnsliced()`; keep the role-less default fail-closed. `viewerRole: 'admin'` is a
weaker fallback: the compiler defaults `visibleTo` to `unique([...editableBy, 'admin'])`
(`services/form-version-compiler.ts:272-277`), so it works for default-configured fields but silently
drops any field whose `x-om-visible-to` was authored without `admin` — exactly the narrow-visibility
signature fields consent recording exists for.

---

### F2 — HIGH — the `/i/:token` resume flow returns an empty payload

`packages/core/src/modules/forms/services/distribution-service.ts:415`
(surfaced at `packages/core/src/modules/forms/api/public/start/route.ts:137`)

```ts
distribution-service.ts:411    const view = await this.submissionService.getCurrent({
distribution-service.ts:412      organizationId: invitation.organizationId,
distribution-service.ts:413      tenantId: invitation.tenantId,
distribution-service.ts:414      submissionId: invitation.submissionId as string,
distribution-service.ts:415      viewerRole: invitation.role ?? null,
distribution-service.ts:416      viewerUserId: invitation.id,
distribution-service.ts:417    })
```

**Why it is wrong.** `invitation.role` is `null` for essentially every invitation in practice:

- `data/validators.ts:435` — `role: roleIdentifierSchema.optional()` on `invitationRecipientSchema`
- `ui/admin/forms/[id]/distributions/RecipientsTable.tsx:91` — the only UI that creates invitations
  pushes `name ? { email, name } : { email }`; it never sends a role
- `services/distribution-service.ts:298` — open-link invitations are created with `role: null`

So `viewerRole` is `null` → sentinel → `view.decodedData === {}`, and
`api/public/start/route.ts:137` returns `decoded_data: {}`. A respondent who opens their personal
link again to continue a draft gets a **blank form** even though the submission holds answers. Before
this change the role-less read returned the full payload, so this is a regression on the module's
headline save-and-resume flow.

Scope check: only the `/i/:token` path reaches `resumeExisting`. `api/public/start/route.ts:96-104`
resolves an invitation only when a token is supplied; `/f/:slug` open mode always mints a fresh
invitation and calls `start()`, whose return value is used directly.

Not data-destroying: `save()` merges only the client's dirty keys into the prior decoded payload
(`services/submission-service.ts:576-585`, and `ui/public/state/useFormRunner.ts:318` sends
`dirtyFieldsRef` only), so untouched answers survive on disk. The damage is the blank resume view.

**Minimal fix.** The correct role is already available — `resumeExisting` computes it three lines
later from `view.actors` (`:420`), and `start()` guarantees a non-null actor role
(`services/submission-service.ts:358-363` throws `INVALID_ROLE` when it cannot resolve one). Resolve
the actor row *before* the read:

```ts
const actor = await em.findOne(FormSubmissionActor, {
  submissionId: invitation.submissionId as string,
  organizationId: invitation.organizationId,
  userId: invitation.id,
  revokedAt: null,
  deletedAt: null,
})
const view = await this.submissionService.getCurrent({
  …,
  viewerRole: invitation.role ?? actor?.role ?? null,
})
```

A better general fix that also covers future callers: have `getCurrent` derive the role from the
actor row matching `viewerUserId` when `viewerRole` is absent, and fall back to the fail-closed
sentinel only when there is no actor either.

---

### F3 — MEDIUM — a raw NUL byte makes the delta's most security-sensitive file binary to git

`packages/core/src/modules/forms/services/submission-service.ts:51`

```
$ LC_ALL=C grep -anP '\x00' packages/core/src/modules/forms/services/submission-service.ts | cat -v
51:const NO_ROLE_SENTINEL = '^@__forms_no_role__'          # ^@ is a literal U+0000
```

**Why it is wrong.** The sentinel embeds a literal NUL rather than the escape `' …'`. It is
legal JS, but:

- `git diff` reports `Bin 39198 -> 40888 bytes` for this file, so the authorization change in it
  cannot be reviewed line-by-line, cannot be reviewed on GitHub, and cannot be textually merged.
  `git grep` / ripgrep report `binary file matches` instead of the hit.
- The value is fragile. Any tool that normalises or strips control characters (a formatter, an
  editor round-trip, a copy through a text field) silently degrades the sentinel to
  `'__forms_no_role__'` — a perfectly collidable plain string — with no test failing.

Three other files in the module already carry NULs inside regex character classes
(`backend/forms/[id]/studio/recall.ts`, `services/form-logic-evaluator.ts`,
`services/pdf-snapshot-service.ts:717`), so this is a pre-existing house habit rather than a novel
mistake — but `submission-service.ts` was text at `d280fb625` and this branch made it binary.

**Minimal fix.** Drop the sentinel; slice explicitly, which is fail-closed by construction, needs no
magic value, and keeps the file diffable:

```ts
const roleSliced = args.viewerRole
  ? this.rolePolicy.resolve(compiled, args.viewerRole).sliceReadPayload(decodedFull)
  : {}
const decodedData = args.viewerRole
  ? sliceByVisibility(roleSliced, resolveVisibleFieldKeys({ compiled, schema: …, role: args.viewerRole, data: decodedFull }))
  : {}
```

If the sentinel is kept for any reason, write it as `' __forms_no_role__'`.

---

### F4 — LOW — the sentinel's collision claim is false

`packages/core/src/modules/forms/services/submission-service.ts:44-50`

```
44  * Stand-in role for a reader who could not name one. No field's `visibleTo` or
45  * `editableBy` can contain it — `x-om-roles` values are authored identifiers and
46  * this is namespaced with characters they cannot use — …
```

**Why it is wrong.** The charset rule the comment relies on does not guard the schema body.
`roleIdentifierSchema` (`data/validators.ts:44-50`, `/^[a-z][a-z0-9_-]*$/`) is applied only to the
form-version **`roles` column** (`data/validators.ts:234`, `:283`). The schema itself is validated as
`jsonObjectSchema` (`data/validators.ts:232`, `:284`), and the root-extension validator for
`x-om-roles` (`schema/jsonschema-extensions.ts:379-380`) only checks `stringArrayValid` — no charset
at all. JSON can carry `" __forms_no_role__"`, and the compiler's only constraint on
`x-om-visible-to` is membership in `x-om-roles` (`services/form-version-compiler.ts:288-293`). So a
schema author *can* declare a field readable by the sentinel.

Practical impact is small — the only role-less readers are F1's and F2's call sites, inside the
author's own tenant — but this comment is the stated justification for the whole design, and the next
person to touch `getCurrent` will trust it.

**Minimal fix.** F3's rewrite removes the sentinel and the claim together. If the sentinel stays,
validate `x-om-roles` entries with `roleIdentifierSchema` in `OM_ROOT_VALIDATORS` and say that in the
comment instead.

---

### F5 — MEDIUM — `yarn i18n:check-usage` now fails; 14 `forms.errors.*` keys ship untranslated

`packages/core/src/modules/forms/backend/forms/page.tsx:120`

Real output from this branch:

```
$ yarn i18n:check-usage
  packages/core/src/modules/forms/backend/forms/page.tsx:120 → forms.errors.internal
Summary: 1 missing keys, 7962 unused keys (advisory)
USAGE EXIT=1
```

`i18n:check-usage` is one of the ordered `validation.commands` in `.ai/agentic.config.json`.

**Why it is wrong.** The branch's own `flash(...)` → `flash(t(...))` correction (correct in itself —
see § What checks out) turned this into a string-literal `t()` call the scanner can see, and the key
exists in no locale file. The scanner catches only this one because the other missing keys reach the
client as `jsonError(status, code)` response bodies rather than `t()` literals. Comparing every
`forms.errors.*` emitted by the module against `i18n/en.json`, **14 are absent from all five
locales**:

```
distribution_not_found  file_too_large        internal            invalid_id
invalid_image           invalid_key           invalid_upload      invitation_no_email
invitation_not_found    invitation_revoked    invitation_submitted not_found
organization_required   tenant_required
```

Two of those call sites were added by this branch (`api/[id]/run/context/route.ts:145` and
`api/[id]/run/submissions/route.ts:238`, both `forms.errors.organization_required`). Several are
rendered verbatim to the user via `flash(t(errPayload?.error ?? …))` —
`backend/forms/page.tsx:109`, `:146`, `backend/forms/[id]/FormStudio.tsx:444`, `:1306`, `:1342`,
`:3169` — so the user sees the raw dotted key in a toast. `forms.errors.internal` in particular is
also the body `handleRouteError` returns on every unhandled 500 (`api/helpers.ts:91`), so it is the
most likely of the fourteen to reach a user.

`yarn i18n:check-sync` passes (exit 0, "All translation files are in sync"), so the five locale files
are consistent with each other — they are uniformly missing these keys.

**Minimal fix.** Add the 14 keys to `packages/core/src/modules/forms/i18n/en.json` and run the locale
sync so pl/es/de/ko follow.

---

### F6 — LOW — the FormStudio optimistic-lock exemption cites a mechanism that does not exist

`packages/core/src/modules/forms/backend/forms/[id]/FormStudio.tsx:422-431`

```
428  // version moves on every batch, and a 409 raised mid-typing has no sensible
429  // recovery. The draft's concurrency signal is instead the server-refreshed
430  // `schemaHash` read back from each response below.
```

**Why it is wrong.** `forms.form_version.update_draft` accepts no expected version and performs no
comparison. It overwrites the draft wholesale and then recomputes the hash from what it just wrote:

```ts
commands/form-version.ts:329      version.schema = deepClone(parsed.schema)   (via the parsed.schema branch)
commands/form-version.ts:353      const compiled = compiler.compile({ … schema: version.schema … })
commands/form-version.ts:360      version.schemaHash = compiled.schemaHash
```

`schemaHash` is a pure function of the caller's own write and is never compared against anything, so
two designers on the same draft silently last-write-wins and *neither* gets a signal. The exemption
itself is defensible — a 409 mid-typing genuinely has no recovery — but the stated reason is not, and
it reads as "this is handled" when nothing is.

Being adversarial about the other two markers, as asked: **both hold up.**

- `backend/forms/page.tsx:138` — "idempotent state transition" is TRUE. `commands/form.ts:304`
  guards with `if (form.status !== 'archived')`, and `forms.form.restore` reverses it
  (`commands/form.ts:387-390`). It is also true that no forms write route reads a version header,
  since none uses `makeCrudRoute`.
- `SubmissionDrawer.tsx:181` — "junction/assignment row" is TRUE and the exemption is quoted
  correctly from `packages/core/AGENTS.md` § Database Entities. `revokeActor` is idempotent:
  `services/submission-service.ts:841`, `if (actor.revokedAt) return`.

**Minimal fix.** Reword marker 1 to state the gap plainly — "draft writes have no concurrency
control; tracked in `.ai/specs/2026-09-30-forms-module-into-core.md` § Known limitations" — and delete
the `schemaHash` sentence.

---

### F7 — LOW — forms entities are not registered in the optimistic-lock coverage guard

`packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts:30`

The curated `moduleEntities` map has no `forms` key, so the guard that exists precisely to catch a new
user-editable entity shipped without `updated_at` is silent about this module.

All three genuinely editable entities do carry the column today —
`data/entities.ts:64` (`Form`), `:124` (`FormVersion`), `:508` (`FormDistribution`) — so this is
registration debt rather than a live gap, but nothing stops a future edit from dropping one.

**Minimal fix.** Add `forms: ['Form', 'FormVersion', 'FormDistribution']` to `moduleEntities`.

---

### F8 — LOW — `getCommandInterceptorHttpRejection` inlined 17×; 2 of 19 catch blocks missed

`packages/core/src/modules/forms/api/helpers.ts:64` plus the 17 call sites

**Placement order is correct** — I checked this specifically because the order asked. The inline block
runs before `handleRouteError`, and `CommandInterceptorError` is neither a `CrudHttpError` nor a
`ZodError`: all three use distinct `Symbol.for` markers
(`packages/shared/src/lib/commands/errors.ts:3` and `:47` vs `shared/lib/crud/errors`), so no arm
shadows another and the new ZodError arm at `api/helpers.ts:86` is unaffected. Nothing regresses.

**Why it should still change.** All 19 catch blocks already funnel into `handleRouteError`, and all 17
inserted blocks are byte-identical. Duplicating the arm makes coverage a per-file judgement call, and
two files were in fact missed:

- `api/[id]/versions/[versionId]/diff/route.ts:119`
- `api/[id]/theme-logo/route.ts:123`

Neither dispatches a command today, so there is no live bug — but the omission is unexplained, while
four GET handlers that *also* never dispatch a command (`api/route.ts:164`,
`api/[id]/route.ts:115`, `api/[id]/distributions/route.ts:111`,
`api/distributions/[distributionId]/invitations/route.ts:131`) did get the block. The placement is not
principled in either direction.

**Minimal fix.** Delete the 17 blocks and put one arm in `handleRouteError`, before the
`logger.error` / 500 (`console.error` at the reviewed revision; the branch tip has since routed it
through `createLogger`):

```ts
const interceptorRejection = getCommandInterceptorHttpRejection(error)
if (interceptorRejection) {
  return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
}
```

---

### F9 — INFO — pre-existing vendored bug: the retention purge skips rows

`packages/core/src/modules/forms/workers/retention-purge.ts:102-142`

Out of scope for the verdict (vendored code; the branch touches only line 132 to pass the new scope),
flagged because this is the last review before it lands in core.

The batched scan filters `anonymizedAt: null` (`:111`) while the loop sets `anonymizedAt` on eligible
rows (`:132`), then advances `offset += batchSize` (`:141`). Anonymized rows leave the filtered set,
so page N+1 skips as many still-eligible rows as page N purged. With a full first page where half the
rows are eligible, roughly half of every subsequent page is never scanned. Each run purges some rows,
so it converges eventually across many runs, but a single run does not do what its counters claim.

**Minimal fix.** Drop `offset` and keep re-querying page 0 while it yields eligible rows, or keyset-
paginate on `id`.

---

## What checks out

Stated plainly, because the order asked for it. Each of these I traced rather than assumed.

**Q1 — is the `getCurrent` slicing genuinely fail-closed?** Yes, at the boundary.
`RolePolicyService.resolve` builds the visible set with `descriptor.visibleTo.includes(role)`
(`services/role-policy-service.ts:57`) and `resolveVisibleFieldKeys` short-circuits on `!canRead`
(`services/visibility-resolver.ts:40`), so an unknown role yields `{}` from both layers. The two
sub-questions had real answers though: the collision claim is false (**F4**) and there *were* callers
relying on the unsliced read (**F1**, **F2**).

**Q2 — does `runtime-principal`'s customer branch break a legitimate flow?** No. Six call sites across
five files, all under `api/public/submissions/[id]*`
(`route.ts:48`, `route.ts:98`, `submit/route.ts:64`, `pdf/route.ts:40`, `attachments/route.ts:50`,
`attachments/[attachmentId]/route.ts:36`). Every shipped client of those routes is
`createAnonymousRuntimeClient`, which always sends `Authorization: Bearer …`
(`ui/public/state/runtime-client.ts:318`), so it takes the token branch. The portal pages
(`frontend/[orgSlug]/portal/forms/[key]/page.tsx`,
`frontend/[orgSlug]/portal/submissions/[id]/continue/page.tsx`) use `createAuthRuntimeClient` against
`/api/forms/form-submissions/*`, which authenticate with `getCustomerAuthFromRequest` directly and
never call `resolveRuntimePrincipal`. The customer branch is therefore reachable only by a caller
presenting a portal cookie and no token — which is exactly the hole being closed, and the hole was
real: before the change that caller got `role: null` and read any submission in their org fully
decrypted.

**Q3 — is the retention worker passing the right anonymize scope?** Yes. It selects submissions with
`organizationId: scope.organizationId, tenantId: scope.tenantId`
(`workers/retention-purge.ts:106-107`) and passes that same pair to `anonymize`
(`:132-135`). The admin route passes `auth.tenantId` / `auth.orgId`
(`api/submissions/[submissionId]/anonymize/route.ts:83-85`). Making the parameter required rather than
optional is the right call for an irreversible operation, and the new test covers both the
cross-tenant and cross-org refusal and asserts the rows are left intact
(`__tests__/anonymize-service.test.ts:224-248`).

**Q4 — do the anonymous and invitation flows still submit?** Yes, and the check is better than its
own comment claims. It looks up *any* active actor row for `submittedBy`, not specifically
`startedBy`, so an `assignActor` grantee still submits.
- `/i/:token` and `/f/:slug`: `submittedBy: principal.principal`
  (`api/public/submissions/[id]/submit/route.ts:102`) = `verified.invitationId`
  (`lib/runtime-principal.ts:60`) = the `startedBy` used at `services/distribution-service.ts:318`.
- Staff: starts as `auth.sub` (`api/form-submissions/route.ts:87`), submits as `auth.sub`
  (`api/form-submissions/[id]/submit/route.ts:57`).
- Portal customer: `resolveRuntimePrincipal` already requires the actor row, so `submit()` cannot be
  reached without one — the two checks are consistent rather than redundant.

**Q5 — any bypass around `navigable-url`?** No. There are exactly two places in the module that
assign a designer-supplied target to `window.location`, and both normalise at the sink:
`ui/public/FormRunner.tsx:170` (distribution `redirect_url`, the anonymous `/f/` and `/embed/`
surfaces) and `runner/FormRunner.tsx:130` (an ending section's `x-om-redirect-url`, the in-app
runner). Every other `window.location` reference in the module reads `.origin` or `.ancestorOrigins`.
Re-checking at the sink is genuinely reached before navigation in both — the value is normalised
before the `useEffect` / `if` that navigates, and a rejected target yields `null`, which both guards
test. The zod refinement is correctly positioned inside `.optional().nullable()`
(`data/validators.ts:326-333`), so absent and explicit-null still pass, and rows written before the
validator was hardened are caught at the sink. The premise is verified too — the new test
`__tests__/navigable-url.test.ts:32-35` pins that this repo's zod accepts `javascript:` through
`z.string().url()`, which matches the known behaviour of zod 4's `url()`.

**Q6 — is the page calling `api/[id]/run/*` still coherent?** Yes.
`frontend/forms/[id]/run/page.tsx:30` is the only caller of either route anywhere in the repo, and
`runner/FormRunner.tsx` (which defaults its submit endpoint to `/run/submissions`, `:112`) is imported
by that page alone. The branch added `frontend/forms/[id]/run/page.meta.ts` with `requireAuth: true`,
matching the routes' new `requireAuth: true`. Both routes now scope the `Form` lookup by
`tenantId, organizationId` (`run/context/route.ts:152`, `run/submissions/route.ts:244`). The
reasoning in the new file comments — a form UUID is not a capability a tenant handed out, unlike a
distribution slug or an invitation token — is sound, and the OpenAPI docs were updated with the new
400/401 arms.

**Q7 — is the interceptor-branch placement correct?** Yes; see **F8** for the ordering proof and the
maintainability objection.

**Q9 — does `TEMPLATE_COMMENTED_MODULES.forms` match, and does it fail loudly?** Yes to both,
verified programmatically rather than by eye:

```
source present in app modules.ts: true
template present in template modules.ts: true
source ALSO present in template (would be wrong): false
```

`commentOutTemplateModules` (`scripts/template-sync.ts:327-333`) calls `failTemplateTransform` when
the source block is not found, so rewording the app comment breaks the transform rather than silently
skipping it. Keeping the module commented out in the template with the harness-recertification
rationale is the right call — it matches the `enabling a module triggers harness re-certification`
constraint.

**Design-system token fixes are correct.** Every replacement suffix is real; every replaced one was
not. `apps/mercato/src/app/globals.css` defines exactly `{bg, border, icon, solid, text}` per status,
so the old `-foreground`, `-surface` and `status-danger-*` names compiled to no CSS at all — silently
unstyled, which is why they survived in the standalone package. A sweep of the module finds zero
remaining invalid status tokens:

```bash
$ grep -rno "status-[a-z]*-[a-z]*" --include=*.ts --include=*.tsx . | sed 's/.*://' | sort -u \
    | grep -vE "status-(error|info|neutral|pink|success|warning)-(bg|border|icon|solid|text)$"
(no output)
```

**The `flash(key)` → `flash(t(key))` sweep is correct.** `flash(message: string, …)`
(`packages/ui/src/backend/FlashMessages.tsx:40`) dispatches the string verbatim and never translates,
so every previous call rendered a raw dotted key to the user. (It also exposes **F5**.)

**Removing `registerSubmissionCommands` is right.** It matches the house pattern —
`customers/commands/index.ts` is bare `import './x'` lines, and forms' own sibling command files
already register at top level (`commands/form.ts:445`). `registerCommand` does throw on a duplicate id
outside development (`packages/shared/src/lib/commands/registry.ts:25-34`), but each command file
resolves to a single module instance and the siblings already depend on that, so removing the
`registered` latch introduces no new risk. The `import './submission'` added to `commands/index.ts` is
what actually makes the six handlers reachable.

**`requires: ['attachments', 'customer_accounts']` is accurate.** `requires` is a real `ModuleInfo`
field (`packages/shared/src/modules/registry.ts:224`), and both are unconditional imports, not
optional peers: `attachments` at `api/[id]/theme-logo/route.ts:21,26,27`, and `customer_accounts` via
`getCustomerAuthFromRequest` in seven files including `lib/runtime-principal.ts:16`. Neither is behind
a `tryResolve`, so a hard `requires` is correct rather than a decoupling violation.

**The GDPR route relocation is right.** `api/forms/subjects/…` → `api/subjects/…` is correct because
module API routes are namespaced by module id — the old layout served
`/api/forms/forms/subjects/…`, not the `/api/forms/subjects/…` its own docs promised.

**`FieldTypeRegistry.keys()`'s explicit comparator is a genuine no-op.** `Array#sort()` with no
comparator and `(a, b) => (a < b ? -1 : a > b ? 1 : 0)` both compare UTF-16 code units, so
`registryVersion` hashes are byte-identical and already-compiled form versions keep their hash — the
comment's claim holds. Same for the identical change at
`backend/forms/[id]/studio/palette/FormAppearancePanel.tsx:91`.

**`extension-points.ts` is wired correctly.** All four declared `spotId`s are actually mounted by the
file named in `source` (`SubmissionDrawer.tsx:249, 253, 299, 327`), and `source` points at the
component itself rather than a barrel, which would silently unbind the host. Removing the unmounted
`forms:embed` mapping from `widgets/injection-table.ts` is right — no file in the repo mounts that
spot.

---

## Validation run

Local mode (no compose `app` container running). `export TMPDIR=/tmp` before every command; a fresh
`yarn install` first. `yarn db:migrate` was never run.

| Command | Exit | Output |
|---|---|---|
| `yarn build:packages && yarn generate && yarn build:packages` | **0** | 38/38 tasks successful |
| `yarn typecheck` | **0** | 38/38; `@open-mercato/core:typecheck: cache miss, executing f37decad3652b1e6` — it really ran |
| `yarn i18n:check-sync` | **0** | "All translation files are in sync." (5 locales, 62 modules) |
| `yarn i18n:check-usage` | **1** | `Summary: 1 missing keys, 7962 unused keys (advisory)` — see **F5** |
| `yarn test --env-mode=loose` | **129** | Only failing task `open-mercato-docs#test` (`apps/docs`, exit 129) — unrelated to this branch; 7/44 tasks completed before turbo aborted |
| `cd packages/core && yarn jest src/modules/forms` | **0** | `Test Suites: 64 passed, 64 total` / `Tests: 813 passed, 813 total` |
| `cd packages/core && yarn jest` | **0** | `Test Suites: 2 skipped, 2064 passed, 2064 of 2066 total` / `Tests: 18 skipped, 18898 passed, 18916 total` |
| `yarn build:app` | **0** | `@open-mercato/app:build: ✓ Compiled successfully in 45s` (cache miss — it really compiled) |

Because the root `yarn test` aborted on the unrelated docs-app failure, I ran the core package's jest
directly (which is also the correct way to run jest in this repo — the root invocation trips
`TS5011`). The full core suite is green, which is the point worth recording: **it is green over both
HIGH findings.**

`yarn i18n:check-usage` is the only gate command that fails on the branch's own code.

---

## Summary

| # | Sev | Location | Finding |
|---|---|---|---|
| F1 | HIGH | `forms/di.ts:161` | Consent projection reads `{}` — GDPR consent records silently never written |
| F2 | HIGH | `forms/services/distribution-service.ts:415` | `/i/:token` resume returns an empty payload; respondents see a blank form |
| F3 | MED | `forms/services/submission-service.ts:51` | Raw NUL byte makes the file binary to git and the sentinel fragile |
| F5 | MED | `forms/backend/forms/page.tsx:120` | `i18n:check-usage` fails; 14 `forms.errors.*` keys ship untranslated |
| F4 | LOW | `forms/services/submission-service.ts:44` | Sentinel collision claim is false — `x-om-roles` has no charset validation |
| F6 | LOW | `forms/backend/forms/[id]/FormStudio.tsx:429` | Lock exemption cites a `schemaHash` mechanism that does not exist |
| F7 | LOW | `core/src/__tests__/optimistic-lock-editable-entities.test.ts:30` | forms entities unregistered in the coverage guard |
| F8 | LOW | `forms/api/helpers.ts:64` + 17 sites | Interceptor arm duplicated 17×; 2 of 19 catch blocks missed |
| F9 | INFO | `forms/workers/retention-purge.ts:141` | Pre-existing vendored offset-pagination skip |

F1, F2 and F5 should be fixed before merge. F3 is worth fixing in the same pass because its rewrite
resolves F4 for free and restores a reviewable diff on the file that most needs one. F6–F8 are
cheap and can ride along. F9 is the vendor's and can be a follow-up issue.
