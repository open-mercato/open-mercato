# Phase-0 Findings — OpenCode Sandbox Isolation (Agent File Plane)

> **For:** `2026-06-26-agent-attachments-and-artifacts.md` · **Date:** 2026-06-26 · **Method:** code-grounded audit of the OpenCode client/runner + `docker/opencode/` config, plus OpenCode v1.1.21 docs (web claims marked ASSUMPTION). This doc is the locked contract the spec's sandbox model references.

## Question under test

Can the spec's model — *"per-run sandbox dir keyed by `sessionToken`, with `write`/`edit` scoped to it, on the shared `opencode serve` container"* — be implemented safely (no cross-run/cross-tenant file access)?

## Findings

### F1 — Path-glob write/edit permissions: **CONFIRMED**
OpenCode's `permission` map accepts, per tool, either a shorthand (`allow|ask|deny`) **or** a `{ glob → action }` object. `write` and `edit` both support glob maps.
- Evidence: `docker/opencode/opencode.jsonc.example:28-52` — `"write": { "*": "deny" }`, `"edit": { "*": "deny" }`, `"bash": { "*": "deny" }` (glob-map form, not coarse booleans).
- Implication: writes **can** be confined to a workspace root, e.g. `write: { "/home/opencode/work/**": allow, "*": deny }`. This reliably prevents an agent from writing to `/home/opencode/.config/opencode`, the agent `.md` files, skills, or `$HOME` dotfiles — a real and useful confinement.

### F2 — Permission config is **STATIC** (the load-bearing constraint)
Permission is set in two static places, both fixed before any run:
- The generated agent `.md` frontmatter, **baked into the image at build** (`Dockerfile:35` copies agents into `/home/opencode/.config/opencode/agents/`; rendered by `defineFileAgent.ts:257-261`).
- The entrypoint-generated `opencode.jsonc` (`docker/opencode/entrypoint.sh`), fixed at container boot.
- There is **no per-session or per-message permission override** wired in the OM client (`packages/ai-assistant/src/modules/ai_assistant/lib/opencode-client.ts`), and none confirmed in the OpenCode API for v1.1.21 (ASSUMPTION-to-verify).

**Consequence:** a permission glob cannot contain the per-run `sessionToken`. The best a static glob can express is a **shared** workspace root (`/home/opencode/work/**`) — which confines writes *away from OpenCode internals* (F1) but does **not** isolate run A's subdir from run B's, because both match the same static glob.

### F3 — Session working directory (`cwd`): **UNVERIFIED**
- OM's `createSession()` POSTs an empty body — `opencode-client.ts:266` `body: JSON.stringify({})` — and the runner uses only `session.id` (`openCodeAgentRunner.ts:118,127`).
- The `OpenCodeSession` type *does* carry a `directory: string` field (`opencode-client.ts:29`), suggesting the server is directory-aware, but OM never sets or reads it.
- Whether `POST /session` accepts a `directory`/`cwd` and honors it as the session working dir on **v1.1.21** is an **ASSUMPTION-to-verify-against-the-running-image** (create a session with `{ directory }`, have the agent run `pwd`).

### F4 — No isolation today
All sessions default to `/home/opencode` (`Dockerfile:23`); the runner has no workspace-management code (`openCodeAgentRunner.ts:109-227`). Concurrent write-enabled runs would collide.

### F5 — OM↔container filesystem gap
OM (Node host) and OpenCode (separate container) do **not** share a filesystem by default. To stage inputs into `in/` and collect artifacts from `out/`, OM needs read/write access to the container's workspace — i.e. a **shared volume / bind mount** is required regardless of the isolation mechanism chosen.

## Verdict

**The "scope writes per-session via permissions on the shared concurrent container" model is NOT achievable** (F2). Path-glob confinement is real but only workspace-root-level, not per-run (F1+F2). Therefore **cross-run isolation must come from container exclusivity, not from the permission map.**

### Chosen v1 model (decisive)
1. **Shared volume** mounted into the OpenCode container at the workspace root `OM_OPENCODE_WORKSPACE_ROOT` (default `/home/opencode/work`), also writable by the OM runtime (F5). `AgentWorkspaceManager` and `AttachmentStager`/`ArtifactCollector` operate on this mount.
2. **Container exclusivity for isolation** — a run **leases a container from a pool and holds it exclusively for its lifetime** (single active run per container). The workspace subdir is created per `sessionToken`, and **wiped before the container is returned to the pool**. Isolation is guaranteed by exclusivity + wipe, not by permission-per-session.
3. **Path-glob write confinement (static)** — frontmatter/`opencode.jsonc` set `write`/`edit`/`read` to `{ "<workspaceRoot>/**": allow, "*": deny }` so even within its exclusive lease the agent cannot escape the workspace to OpenCode internals (F1). `bash` stays `deny`.
4. **Absolute sandbox paths** — because per-session `cwd` is unverified (F3), `buildMessage` tells the agent the **absolute** `in/`/`out/` paths under `<workspaceRoot>/<sessionToken>/`. (If F3 later verifies, setting the session `directory` lets agents use relative paths — a nicety, not a requirement.)

### Fallbacks / escalation
- **Stronger isolation (Phase 4):** per-run **ephemeral container** — clean isolation by construction, at the cost of `opencode serve` boot latency per run. Use if the pool-lease wipe proves insufficient or concurrency demand is high.
- **Upstream enabler (track):** if OpenCode adds **per-session permission scoping** (or confirmed honored per-session `directory` + session-relative globs), the shared container could safely multiplex concurrent runs without exclusive leases — revisit then.

## Items to verify against the running v1.1.21 image (carry into Phase 1)
1. `POST /session` accepts a `directory`/`cwd` field and honors it (`pwd` test) — F3.
2. Exact glob syntax + precedence for `permission.write`/`edit` (deny-`*` + allow-subtree) — confirm `**` semantics and that allow-subtree overrides deny-`*`.
3. Whether any per-session/per-message permission override exists (would relax the exclusivity requirement) — F2.
