# Harness release gate

Run the complete per-release gate from a generated standalone app with one command:

```text
yarn harness:release --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

`--prepare-targets` accepts only an absolute, new or empty regular directory outside the controller app. The controller must be a sanitized fresh scaffold: automatic preparation fails before copying when it finds `.env`, `.env.*` (except `.env.example`, `.env.sample`, and `.env.template`), credential files, or private-key files. Never use a configured development or production app as the controller. It copies the fresh scaffold once per catalog case whose `evaluationKind` is `implementation` or `regression`, while excluding `.git`, `node_modules`, build/cache/coverage output, `.ai/harness/results`, `.ai/reports`, and `.ai/framework-context`. Each target receives a guarded link to the controller's installed dependency tree. The OS sandbox resolves that link as read-only during both the writable model run and the target command gate. The release gate also hashes every dependency entry and regular-file body once before execution and once after the complete suite, and fails if any nested content or metadata changed. A generated `release-targets.json` records the local mapping.

## Containment prerequisites and policy

The writable release lane fails closed unless host-level containment is available:

- macOS requires the system `/usr/bin/sandbox-exec` implementation;
- Linux requires `bwrap` (Bubblewrap) on `PATH` with user namespaces available;
- native Windows is not supported for writable release evaluation. Run the command in a Linux container/VM with Bubblewrap rather than weakening containment.

The writable model process may use network access only for its configured model provider. It can write only the disposable target and its isolated result/config directory; controller dependencies are read-only. Host file contents are hidden except for the target, resolved dependency tree, isolated runner authentication copy, executable/runtime directories, and a fixed OS runtime allowlist. Trace validation independently rejects out-of-scope reads and selections.

Linux containment unshares every namespace, including PID, user, IPC, UTS, cgroup, mount, and network; provider-backed model runs alone opt back into the host network. Network-free commands remain isolated, while generated HTTP/browser tests receive only loopback inside the isolated namespace. macOS applies equivalent file and network restrictions and grants Chromium only its exact rendezvous Mach name plus the `RootDomainUserClient` needed by the bounded headless runtime. Interpreter/eval shell commands, unknown commands, command-supplied grep/rg pattern or ignore files, recursive content reads, and executable/mutating `sed` forms make the trace fail closed.

Model-authored `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build` commands run with network access denied. Their environment is rebuilt from a small allowlist: `PATH`, isolated `HOME`/temporary/XDG directories, an existing read-only `COREPACK_HOME` tool cache when present, the Windows launcher variables on supported hosts, and deterministic CI/telemetry/time-zone flags. Provider credentials, package-registry tokens, database URLs, and arbitrary parent environment values are never inherited. The commands can write the disposable target and isolated temporary directory, but the resolved dependency tree stays read-only. A missing sandbox, denied namespace setup, missing offline package-manager runtime, unsafe target link, or dependency fingerprint mismatch fails the gate.

Generated tests use a stricter lane. The controller resolves the Jest or Playwright CLI from the protected dependency tree and invokes it with fixed arguments; package scripts and `npx` are never executed. The report and review evidence bind the normalized direct Node argv, CLI package, and exact CLI file hash—not a package-script alias. The complete target is read-only, and only an isolated temporary output/cache directory is writable. Unit tests have no network. API and browser tests receive isolated loopback only, must start self-contained `127.0.0.1` servers, and cannot reach external addresses. The browser lane exposes only the exact installed Chromium headless-shell revision through an isolated cache link—not the surrounding host browser cache. Missing CLIs, browsers, or isolation fail closed. No Docker socket, host credentials, or inherited provider configuration enters this lane.

For externally prepared apps, `--writable-targets /absolute/release-targets.json` remains supported. The manifest must assign every writable case to its own fresh generated app:

```json
{
  "schemaVersion": 1,
  "targets": {
    "OMH-009": "/absolute/fresh-app-for-OMH-009",
    "OMH-011": "/absolute/fresh-app-for-OMH-011"
  }
}
```

The current catalog contains 184 cases, including 39 writable implementation/regression cases (21.2%). The command still derives all counts and case IDs from `cases.json`, `validators.json`, and `release-matrix.json`; those figures are documented release facts, not runner constants. Run `yarn install-skills` first so the pinned external `om-code-review` skill and ownership evidence are present. Before running a model or writing a fixture, the release command requires complete deterministic, live-routing, writable, trusted-oracle, target, generated-test, and generated-code-review coverage. Every one of the 39 writable cases must have an `om-code-review` assignment. Missing business fixtures or release-matrix entries fail preflight and are listed by exact case ID in the report.

After preflight it runs, in order:

1. deterministic validation for the complete catalog;
2. the release matrix's fixed `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build` foundation;
3. every configured live-routing runner selection;
4. fixture preparation and the assigned writable runner for every writable case, including the controller-owned AST/behavior oracles and target typecheck;
5. `yarn generate`, `yarn typecheck`, `yarn lint`, and `yarn build` in every writable target, after its trusted oracles;
6. real generated-code execution for OMH-163 through fixed Jest, OMH-164 through API-only Playwright, and OMH-165 through real-browser Playwright; and
7. explicit isolated `om-code-review` for every writable result, bound to its passing command attestation, any required generated-test result and artifact hash, and the final target fingerprint.

Each writable target is single-use because fixture preparation marks it disposable. Externally supplied target realpaths must be pairwise disjoint and neither equal to, contain, nor be contained by the controller. A failed deterministic or foundation-validation step prevents model execution. Once fixture preparation succeeds, all four target commands run even when the writable gate itself fails, so every generated target has exact diagnostics. Generated tests run only after the trusted writable oracle and all four target commands pass; review then requires all applicable gates. A target command or generated-test failure is recorded with its sanitized diagnostic and review is skipped. Other matrix entries continue so the report remains useful.

UI-routed implementation reviews receive only the bounded backend UI guide and `om-backend-ui-design` design-system references. Non-UI reviews do not receive that extra context.

The command writes a mode-`0600` `*-release-suite.json` artifact under `.ai/harness/results/`. It stores no raw runner transcripts, target paths, environment values, URL credentials, or provider credentials. Deterministic and `generate`/`typecheck`/`lint`/`build` foundation commands receive the same minimal isolated environment as target validation, not the controller process environment. Exact values of sensitive inherited environment variables and every scalar string copied from Codex `auth.json` or Claude `.credentials.json` are held only in memory and redacted from all structured results and errors. The report contains exact coverage gaps, sanitized per-target command/test outcomes and actionable failure reasons, first-pass and correction rates, aggregate context-token measures, review verdict counts, and categorized misuse/violation rates.
