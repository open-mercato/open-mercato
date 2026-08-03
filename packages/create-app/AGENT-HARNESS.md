# Standalone AI Development Harness — validation & model-capability notes

This document explains (1) exactly how the harness validates a **code-generation
case** end to end, and (2) where the harness depends on the LLM's capability and
how it could be made **capability-aware** so weaker models can be evaluated
without changing the strict behavior used for stronger models.

All paths are under `packages/create-app/agentic/shared/`. Scripts live in
`scripts/`; the JSON contracts and trusted oracles in `ai/harness/`. The behavior
described here is pinned by `packages/create-app/src/lib/agent-harness-evaluator.test.ts`
and `agent-harness-release.test.ts`.

Two entry points cooperate:

- **Evaluator** — `scripts/evaluate-agent-harness.mjs` — evaluates a single case
  (deterministic / routing / writable / generative-judge lane; generated-code-review flags remain aliases).
- **Release gate** — `scripts/run-agent-harness-release.mjs` — orchestrates the
  full per-release matrix, invoking the evaluator and the fixture preparer as
  subprocesses.

A *code-generation case* is any catalog case whose `evaluationKind` is
`implementation` or `regression` (`WRITABLE_KINDS`, `evaluate-agent-harness.mjs:37`).
There are 46 such cases (`ai/harness/validators.json`; asserted in the test suite).
Examples: `OMH-011` (CRUD routes), `OMH-093` (business contact-merge command),
`OMH-163/164/165/192` (test authoring).

---

## Part 1 — How a code-generation case is validated (step by step)

The authoritative single-case path is the evaluator's **writable branch** inside
`liveRun()` (`evaluate-agent-harness.mjs:2196-2326`), invoked as
`--runner <codex|claude> --case OMH-NNN --writable-root <abs> --acknowledge-writes`.
The release gate wraps this in a larger ordered sequence.

### Phase A — Host & catalog preflight
1. **Host isolation preflight** (release): `releaseHostPrerequisiteViolations()`
   requires a working sandbox for every network mode the matrix needs, and on
   Linux runs a nonce-bound namespace / loopback / capability probe
   (`run-agent-harness-release.mjs:765-785`; `execution-sandbox.mjs:137-226`).
   macOS fails closed for any loopback (Playwright) lane
   (`execution-sandbox.mjs:132-135`). An unsupported host exits 2 **before any
   model runs**.
2. **Catalog validation** — the controller executes `cases.schema.json` and then
   `validateCatalog()`; any schema or semantic catalog error for the selected case
   aborts with exit 1 *before* the model is invoked
   (`evaluate-agent-harness.mjs:2348-2363`). Token-scanning validators and
   non-trusted oracles are rejected outright (`:331-340`). The package build test
   also requires every emitted module fact sheet to be referenced by at least one
   catalog case, preventing silent fact coverage drift.
3. **Controller dependency fingerprint** is captured once and re-checked after the
   whole suite (`run-agent-harness-release.mjs:962-993, 1698-1715`).

### Phase B — Fixture preparation
4. A **fresh disposable target app** (separate from the controller) is required.
   Release clones a sanitized fresh scaffold per case and symlinks `node_modules`
   to the controller's protected tree (`run-agent-harness-release.mjs:306-336`).
5. `scripts/prepare-agent-harness-fixture.mjs` seeds exactly the case's
   `fixture.setup[0]` files and drops the `.ai/harness/DISPOSABLE` marker
   `{caseId, fixtureId}` (`:159-213`). It **fails closed** if the target is not a
   standalone app, is inside the controller, is already prepared, or if a seed path
   escapes `allowedWrites`, is unsafe, or would overwrite a file; seed writes use
   `O_EXCL | O_NOFOLLOW` (`:120-199`). Any preparer failure skips the writable +
   downstream steps.
6. A writable case may declare one to three bounded `frameworkContext` queries. Before the
   baseline snapshot, the trusted controller runs the emitted
   `framework-context.mjs` against the target, rewrites its manifest and search
   evidence to app-relative paths, and admits only that materialized output root to
   the read allowlist. The model receives the exact manifest, search result, and
   source root. Exact fact-linked `node_modules/@open-mercato/*/src/**` reads are
   warning-level examples; broad dependency discovery and all dependency writes remain forbidden.

### Phase C — Pre-edit verification & "before" oracle
7. `verifyWritableTarget()` (`:1788-1836`) asserts the target is a real non-symlink
   dir, `node_modules` is a symlink into the controller's real dependency tree, the
   `DISPOSABLE` marker matches this case, fixtures are seeded, and every writable
   anchor is symlink/special-file-free. Any error → exit 2.
8. **Before snapshot** — `snapshot(runRoot)` hashes every file/dir/symlink and
   fingerprints protected roots (`.git`, `node_modules`, `.next`, `dist`,
   `.ai/harness/results`) separately (`:1589-1615`).
9. **Before oracle runs** (`:2215`). **Fail-closed gate:** if the oracle already
   *passes* before the edit, the run aborts — a code-gen/regression contract must
   genuinely fail first (`:2217`). Invalid oracle output → exit 2 (`:2216`).

### Phase D — The agent run (ephemeral, sandboxed, MCP-only)
10. **Prompt** = `buildPrompt(case, runRoot, writable=true)` + an explicit
   "implement only under these allowed app-relative paths: `<allowedWrites>`"
   suffix (`:2218`). The untrusted task text is fenced in `<UNTRUSTED_TASK>` and the
   model is told to use the write tool then re-read the file; network/env
   inspection, bulk globbing, and reading `.ai/harness/**` are forbidden
   (`buildPrompt:1423-1438`).
11. **Read allowlist** = `caseReadAllowlist()` — `AGENTS.md`, `context.required` +
    `allowedExtra`, route-standard guides, each supporting skill's `SKILL.md` +
    `references/**`, controller-materialized `frameworkContext`, plus (writable)
    `allowedWrites` (`:1137-1151`). **Write allowlist** = `allowedWrites`.
12. `runAgentOnce()` (`:1503-1587`) launches **one fresh process per attempt**:
    - The **only tool surface** is an evaluator-owned MCP file server launched with
      an empty env (`/usr/bin/env -i node agent-harness-tool-server.mjs …`,
      `:1440-1450`). It exposes exact-path `read` and (writable) atomic `write`,
      re-validates every path against the allowlists, rejects
      absolute/traversal/symlink/forbidden paths (`.env*`, `.git`, undeclared dependencies,
      `.ai/harness`, secret extensions), caps I/O at 256 KiB, and writes via temp
      file + `O_EXCL` rename (`agent-harness-tool-server.mjs:30-101, 146-151`).
    - **Codex**: all built-in tools disabled, `--sandbox workspace-write`,
      `network_access=false`, `shell_environment_policy.inherit=none`,
      `approval_policy="never"`, only `read`+`write` MCP tools (`:1454-1480`).
      **Claude**: `--strict-mcp-config --setting-sources ''
      --disable-slash-commands --permission-mode <dontAsk|acceptEdits>
      --tools ToolSearch --allowed-tools mcp__harness__read[,mcp__harness__write]
      --no-session-persistence` (`:1482-1500`). Claude Code exposes MCP tools by
      **deferred discovery**: they are absent from the initial tool list and become
      callable only after the built-in discovery tool loads their schema, so the
      built-in surface is exactly that one capability-free tool and the harness
      tools are permission-allowlisted. `--safe-mode` cannot be used — it disables
      all customizations *including* `--mcp-config` servers — and plan mode cannot
      be used because it returns a plan instead of performing the reads the trace
      gate requires. Isolation comes from `--setting-sources ''` (no user, project,
      or local settings, hooks, skills, or project instruction files),
      `--strict-mcp-config`, the isolated `CLAUDE_CONFIG_DIR`, and the outer OS
      sandbox.
    - The process is wrapped in the **OS sandbox** `sandboxedInvocation()`
      (writable roots = `[target, tempDir]`, read-only = dependency + tool-server
      dirs); Linux = Bubblewrap `--unshare-all --cap-drop ALL`, macOS =
      `sandbox-exec` (`execution-sandbox.mjs:258-313`).
    - Provider auth is copied into an isolated `HOME`/`CODEX_HOME`/
      `CLAUDE_CONFIG_DIR` and the secrets are remembered for redaction (`:1512-1541`).
    - The structured result is validated by `validateResponse` (shape) **and** the
      JSON-Schema (`:1573-1575`). **Retry:** exactly one for
      `invalid-structured-output`, a recognized transient Claude failure, or a
      read-only routing response whose failures are all correctable contract
      assertions. Routing correction starts a fresh isolated process and receives
      no case-specific expected answer. Trace/safety failures, runner-declared
      violations, forbidden patterns, and writable runs are never assertion-retried;
      `attempts ≤ 2`, `corrections ≤ 1`.
    - Cases may supply a `decisionVocabulary` that contains the mandatory labels
      plus contrastive distractors. Selecting a distractor is recorded as an
      `unmandated decision`; cases without that field retain the prior exact
      `requiredDecisions` behavior.

### Phase E — Trace / observation validation (fail-closed)
13. `observedContext()` reconstructs exactly which files the model read from the
    runner's event stream (MCP `read` calls + any traced shell reads, `:1199-1295`).
    - No recognized tool event → `runner trace unavailable`; tool events but zero
      context reads → `runner trace contained no observed context reads`
      (`:1219, :1286`).
    - Any read of a hard-forbidden pattern or the case's `forbidden` paths →
      `forbidden context read` (`:1253, :1281`).
    - Out-of-root / `~` / broad `.`/`*` / directory / symlink / arbitrary app-root
      reads → specific `unsafe …` violations (`:1081-1099, :1258-1284`). Shell
      traces are constrained to bounded read/metadata commands; interpreters and
      env/process inspection are violations (`analyzeCommand:836-996`).
14. `evaluateRouting()` (`:1344-1408`) grades the declared response: required
    routes/skills/decisions present, none invented, every selected context
    **actually observed**, every observed permitted-context path **declared**
    (`observed context not declared`, `:1382-1385`), forbidden-pattern regexes not
    matched, and the three **context budgets** (`maxContextFiles`,
    `maxInitialContextBytes`, `maxTotalContextBytes`) not exceeded (`:1405-1407`).
    Undeclared observed reads are **never merged** into declared context.

### Phase F — Post-edit snapshot & AST/behavior oracles ("after")
15. **After snapshot** + `changedPaths`. Gates: writes to protected roots
    (`:2263`), writes outside `allowedWrites` (`:2265`), or symlink/special/
    unreadable changed entries (`:2267`) each fail.
16. If protected/unsafe changes occurred the **after oracle is skipped** with a
    failure note; otherwise the trusted oracles run **from the controller copy
    only** (`:1711-1749`) — a planted oracle inside the target is never executed.
17. **AST oracle** `ai/harness/writable-ast-oracles.mjs` parses the case source
    with the *target's* TypeScript, extracts structural facts, runs per-case checks,
    and in the **after** phase also runs `yarn typecheck` in a sandbox (`:1038-1102`).
    **Behavior oracle** `ai/harness/writable-behavior-oracles.mjs` runs for
    integration/workflow/regression/business families — it **compiles the exported
    seam and executes it inside a `vm` sandbox** against mocked `effects` (3 s
    worker timeout, 256 KiB source cap) to prove runtime invariants an AST cannot.
18. **Post-oracle mutation guard:** a third snapshot detects whether the oracle run
    itself changed the target → `oracle execution modified target` (`:2279-2281`).
19. The `writable` result records `changedPaths`, `beforeOraclePassed` (must be
    `false`), `afterOraclePassed` (must be `true`), and `targetFingerprint`.

### Phase G — Result persistence
20. `status = violations.length ? 'fail' : 'pass'`. The result is recursively
    sanitized (paths, homedir, provider secrets, tokens redacted), **schema-validated
    before writing** (a schema-invalid result → exit 2, no artifact), and stored
    mode-`0600` under `.ai/harness/results/` (`:1838-1852`).

### Phase H — Target validation commands (release lane)
21. After a passing writable result, release runs the **four-command gate**
    `yarn generate / typecheck / lint / build` against an **isolated copy** of the
    target in a network-denied sandbox with a minimal rebuilt env (no secrets).
    Only declared output roots may change; the original target must stay
    byte-identical (`run-agent-harness-release.mjs:1195-1264`).

### Phase I — Generated tests (release lane, `OMH-163/164/165`)
22. `runGeneratedTestStep()` resolves the Jest/Playwright CLI **from the protected
    dependency tree** and runs it with a **fixed argv** (never package scripts /
    `npx`). Target is read-only; Jest = `network:none`, Playwright = isolated
    `loopback` only. The JSON report must show ≥1 passing test and **zero**
    skipped/todo/focused/flaky/unexpected tests (`:397-428, 1266-1337`).

### Phase J — Generative judge (explicit, read-only, post-oracle)
23. The judge runs only against a *passing* writable result whose oracle evidence is
    `beforeOraclePassed=false && afterOraclePassed=true` with zero violations, the
    prompt hash matches, and the target's **current fingerprint still equals** the
    reviewed one (else "writable target changed after the source result",
    `:2056-2084`).
24. Changed files are copied as **line-numbered inert `.txt` snapshots** into a
    read-only judge bundle with the local `om-judge-agent-session` skill and pinned `om-code-review` skill (verified against
    provenance hashes — a modified installed skill → exit 2), a policy doc, and an
    evidence manifest. The judge runs read-only with an MCP `read` tool and may
    use **at most one** inspection command (`:2090-2141`).
25. The judge response is schema- and semantics-validated: `approve` cannot carry
    a `blocker`/`major` finding, `request changes` requires one, and the report must
    contain the fixed headings and every evidence id. It separately emits artifact findings,
    design-system review, and one smallest harness owner per escaped defect. **Gate:** pass
    only if code review approves, the judge verdict is `pass`, and there are no violations.

### Release order (`buildReleasePlan`, `run-agent-harness-release.mjs:691-722`)
`deterministic:all` → `validation:{generate,typecheck,lint,build}` →
`routing:primary:<runner>` (+ optional `routing:portability:<runner>`) → then **per
writable case**: `fixture:<id>` → `writable:<id>` →
`target-validation:<id>:{generate,typecheck,lint,build}` →
`generated-test:<id>` (if applicable) → `review:<id>`. Foundations gate everything;
a failed deterministic/validation step skips all model steps.

### In one sentence
A code-gen case passes only if it clears **all six gates in order**: sandboxed
agent run → clean trace (fail-closed on undeclared/forbidden reads) →
allowlist-only writes → controller-owned AST **and** behavior oracles with a genuine
before-fail / after-pass transition → post-oracle immutability → (release)
four-command validation + real generated tests + explicit `om-judge-agent-session` pass composing `om-code-review`.
The security spine is: an env-cleared MCP server as the only tool surface, an OS
sandbox as the filesystem/network authority, before/after fingerprinting of even
protected roots, and controller-only trusted oracles, with fingerprint binding
tying the reviewed artifact to the exact validated bytes.

---

## Part 2 — Optimizing for lower-capability models (without changing strong-model behavior)

### 2.1 How the model is selected today
- **Two runners only** — `codex` and `claude` — hard-coded and frozen by tests
  (`evaluate-agent-harness.mjs:159`, `run-agent-harness-release.mjs:22,104`).
- **Model selector is per-runner, config-driven** in the release matrix:
  `routing.runners = { codex:{modelSelector:"default"}, claude:{modelSelector:"sonnet"} }`
  (`ai/harness/release-matrix.json:30-31`; review lane repeats it at `:88-89`).
- Resolved once per run: `const model = options.model ?? releaseMatrix.routing.runners[options.runner].modelSelector`
  (`evaluate-agent-harness.mjs:2199`; review path `:2119`), overridable by a single
  global `--model` (`:150`). At the adapter boundary `'default'` means "omit
  `--model`, use the CLI default"; any other string is passed through
  (`:1478`, `:1499`).
- **You can already point a runner at a weaker model** (matrix selector or global
  `--model`), but it is **global, not per-lane/per-case**, and **none of the
  strictness knobs move with it** — so a weaker model simply fails more cases.

### 2.2 Where a strong model passes and a weak one fails
| Knob | Location | Status today |
|------|----------|--------------|
| Runner set (codex/claude) | `evaluate…:159`, `run…:22,104` | Fixed |
| Model selector per runner | matrix `:30-31,88-89`; `evaluate…:2199` | Config-driven; global `--model` |
| Model **per-lane / per-case** | — | **Not tunable** (one global `model`) |
| Retry count & triggers | `evaluate…:2224-2234, 625-635` | Fixed: max 1 correction; bounded read-only contract assertions, invalid output, and Claude transient failures only |
| Context budgets | `evaluate…:1405-1407`; cases | **Per-case tunable**, capped by catalog maxima |
| Initial-vs-progressive split | `evaluate…:1297-1302` | Fixed |
| `allowedExtra` routing tolerance | `evaluate…:1348`; cases | **Per-case tunable** |
| Tool-call / step ceiling | — (only `--timeout`) | Not present; timeout is global |
| AST count thresholds (≥3 tests/expects, ≥4 `toBe`, ≥2 `persist`) | `writable-ast-oracles.mjs:914,925,1012` | Fixed literals |
| Behavioral exact counts/orderings | `writable-behavior-oracles.mjs` probes | Fixed compiled probes |
| Review verdict rule (any major → request changes) | `evaluate…:650-652` | Fixed |
| Security fail-closed set | Phase E/F above | Fixed (correctly) |

The two biggest structural penalties for weaker models are **(a) the single retry
that excludes assertion failures** — weak models are noisier and more often wrong
on the first try — and **(b) exact-match routing** (every observed permitted read
must be declared and vice-versa), which weak models trip on constantly. Oracle
count/ordering thresholds are calibrated to strong-model output.

### 2.3 Proposal — an additive `capabilityProfile` layer (default == today)
Introduce an optional `capabilityProfiles` object in `release-matrix.json` and bind
a profile to each runner. **When the profile is absent (the shipped default for
`codex:'default'` / `claude:'sonnet'`), every value equals today's constant**, so
all frozen tests and strong-model behavior are byte-for-byte unchanged. Security
fail-closed rules are **excluded from the profile schema entirely** — no key can
relax them, and the release preflight should reject a profile that names a security
check id.

```jsonc
"routing": { "runners": {
  "codex":  { "modelSelector": "default", "capabilityProfile": "strict" },
  "claude": { "modelSelector": "sonnet",  "capabilityProfile": "strict" }
}},
"capabilityProfiles": {
  "strict":  {},                 // empty ⇒ all current constants
  "relaxed": { "retry": {…}, "budgets": {…}, "oracle": {…}, "routing": {…} }
}
```

**A. Per-lane / per-runner model selection.** Let `writable`/`review` steps read a
distinct `modelSelector` (the review lane already has its own `runners` block) so a
weak model can drive *routing* while the security-sensitive writable/review lanes
keep the strong model. Low risk; never silently downgrade the writable/review lanes.

**B. Capability-scaled retry.** The strict harness now includes one generic
fresh-process correction for bounded read-only routing contract assertions. A
future profile could raise the attempt count or enable transient retries for every
runner, but must never retry a trace/safety failure, runner-declared violation,
forbidden pattern, or writable attempt. Attempts and corrections remain recorded
so first-pass and corrected rates stay distinguishable.

**C. Capability-scaled context budgets + a real step ceiling.** Add
`profile.budgetMultiplier` (applied before the `:1405-1407` comparison, still clamped
to catalog maxima) and an explicit `profile.maxToolCalls` in the run loop. Weak:
`1.5×` + `maxToolCalls: 60`; strong default: `1.0×`, no step cap. A weaker model
needs to read more to reach the same answer.

**D. Capability-scaled oracle *quality* thresholds (never security/correctness).**
Thread `profile.oracle` into the two oracle runners to lower the count minimums
(`minTests/minExpects/minToBe`) and swap a few exact behavioral orderings for
set-membership variants. This must touch **only** "did it write enough tests /
render every component / emit events in this exact order" quality checks — encode a
frozen `SECURITY_CHECK_IDS` set (path/symlink guards, no-`require` vm sandbox +
redaction, loopback bind, tenant/org scoping, SSRF block, secret non-leak,
idempotency/rollback atomicity) that a profile can never reference.

**E. Softer routing tolerance (bounded).** Add
`profile.routing.tolerateUndeclaredObservedContext` that, **only for non-forbidden,
in-allowlist** paths, downgrades an undeclared-but-observed read from a hard failure
to a recorded warning. Weak: `true`; strong default: `false`. It must stay
fail-closed for anything the security path rejects.

### 2.4 Backward-compatibility guarantees
- The profile object is new and optional; absence ⇒ the exact constants in code
  today, so every frozen test stays green without edits.
- The release preflight gains **additive** checks that a referenced profile exists
  and names no security check id (fail closed otherwise).
- Record the active profile name in each stored result (next to `model`) so metrics
  can compare weak-vs-strong first-pass / corrections rates — making the tradeoff
  measurable rather than assumed.
- Every change is additive (new optional fields / new lane selectors) — the
  ADDITIVE-ONLY path in `BACKWARD_COMPATIBILITY.md`. `release-matrix.json`,
  `cases.json`, the response schemas, and the two shipped model-selector values are
  contract surfaces frozen by the test suite and must not change value.

**Summary:** today the model is a single global, config-selectable string while
every pass/fail knob is a strong-model-calibrated constant, so a weaker model just
fails more. The fix is an optional per-runner/per-lane `capabilityProfile` that
scales retries (B), context/step budgets (C), and quality-only oracle/routing
thresholds (D, E), with the security fail-closed set structurally excluded from what
a profile can touch and the default profile reproducing current behavior exactly.

---

## Part 3 — What a measured weak-model run actually showed

Part 2 was written before either lane had been exercised on a current CLI. When it
was, the premise changed: **neither runner worked at all**, and once they did, the
weaker model's failures were overwhelmingly *harness* defects rather than capability
limits. Recorded here so the next person tunes from evidence.

### 3.1 Both adapters were broken, and the tests could not see it

| Lane | Symptom | Cause |
|------|---------|-------|
| Claude | 0 of 184; model reported "no read tool is exposed" | `--tools` accepts only **built-in** names, so `--tools mcp__harness__read` resolved to zero tools *and* removed the built-in deferred-discovery tool, which is the only way an MCP tool becomes callable. `--safe-mode` additionally drops every `--mcp-config` server; `--permission-mode plan` returns a plan instead of reading. |
| Codex | 0 of 184; aborted before the model ran | `--disable skill_search` — a feature retired from codex-cli 0.144.6 — is a hard error. |

Both defects survived review because the tests drive a **fake** runner binary that
asserts exactly the flags the code passes. That is a self-confirming contract. A
runner adapter needs at least one authenticated end-to-end case asserting on the
observed *trace*, not only on the constructed argv.

### 3.2 The instruction budget is the binding constraint on router clarity

The generated root sat **5 bytes** under the 12 KiB target. That ceiling is *why* the
router is telegraphic — and telegraphic prose is exactly what a weaker model
mis-reads. Every clarification has to be funded by deleting duplication. Watch three
traps, all of which were hit while doing this:

- Guides are not free either. `.ai/guides/*.md` count as **initial** context, and
  per-case slack runs as low as ~2 KiB (OMH-043), so a 1.4 KiB guide addition can
  push a tight case over its own budget (it did, for OMH-027).
- `references/`, `.ai/guides/modules/`, and `.ai/guides/upstream/` are excluded from
  the initial-context measure — that is where elaboration belongs.
- The largest instruction chain is separately capped at Codex's 32 KiB; a note added
  to `contracts.md` tripped it at 33,023 bytes and had to be reverted.

### 3.3 Weak-model failures clustered on either/or framing, not on difficulty

Sonnet rarely produced a *wrong* answer; it produced an *incomplete* one, and the
same cases failed on Codex — which is the tell that the router, not the model, was
under-specified. Every one of these was a sentence that offered a branch where the
catalog wanted both:

- "App-owned page/form/table-only = `backend-ui`; installed host changes add `umes`"
  made an installed-host **UI** change read as UMES-only.
- "App: `src/modules/<id>/`; installed: UMES" made app code that changes an installed
  module read as `module-data`-only.
- The blueprint row claiming it "resolves ownership" suppressed `architecture`.
- "App primitives skip … `events` unless changed" suppressed the fact sheet for the
  very module a task was about.

### 3.4 Calibrating a trigger: the asymmetry that decides direction

Missing required context is always fatal. A **refused** read is not — the fail-closed
MCP server denies it, and once refusals are scored correctly it is a bounded signal.
So a trigger should sit slightly broad. Two hard limits on that:

1. It must not match text that appears in nearly every prompt. Adding "preserving" to
   the compatibility trigger matched the boilerplate "preserve tenant and organization
   boundaries" and cost Codex 19 false failures in one run.
2. An unexpected **route** is fatal too, so a negative carve-out has to be *correct*
   rather than absent — gating a surface the app injected does select `backend-ui`
   (OMH-037) while hiding an installed page does not (OMH-029/038).

An additive push also needs a matching stop rule, or tight cases over-read: telling a
model to match every row and select every match pushed OMH-027 and OMH-043 past their
file budgets until the assembly policy ranked guide over skill over references.

### 3.5 Where capability-scaled retry would actually apply

After the defects above were fixed, the residual failures were concentrated in
`debugging` cases whose budget permits **five** context files — exactly the size of
their required set, with zero tolerance for one extra read. Across successive runs
those cases moved between different violations under monotonically clearer guidance,
which is the signature of run-to-run variance rather than a missing rule.

That is the population Part 2's retry lever (B) is for. It is now implemented as
one generic fresh-process correction for correctable read-only routing assertions;
the result schema records `attempts` and `corrections` so a first-pass rate and a
corrected rate stay distinguishable.

### 3.6 One catalog inconsistency, recorded rather than papered over

`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` is `required` in 9 cases and, by a
deterministic validator, may never be `allowedExtra` — access is binary. But OMH-057
requires it for a "preserve the seeded … export seam" prompt while OMH-045, OMH-054,
OMH-060, OMH-061, and OMH-070 forbid it on identical wording. No router rule can
satisfy both. The harness-side mitigation is that a refused path is treated as
inapplicable to that case rather than as an unresolved blocker; resolving the
inconsistency itself is a catalog decision for the owner.
