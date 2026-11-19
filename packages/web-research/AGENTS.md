# Web Research Engine

`@open-mercato/web-research` is the adapter-based web search/read engine. It is pure library code:
no DI, no tenants, no ORM, no vendor. Governance (ACL, rate limits, traces, per-tenant policy) lives
in `agent_orchestrator`; individual sources live in their own `@open-mercato/web-research-*` packages.

## Always

- Keep this package **zero-dependency** apart from `zod`. Node builtins only. Adapter packages carry
  their own SDKs; the core must stay installable with no transitive weight.
- Route every byte of egress through `HttpClient` (`src/net/client.ts`). Never call `fetch`,
  `node:https`, or an SDK's own transport from an adapter — that bypasses the SSRF guard, DNS pinning,
  redirect re-validation, byte caps and politeness in one step.
- Return **outcomes, never throw**, from anything implementing `SearchAdapter`. `unavailable`,
  `empty`, `blocked`, `timeout` and `error` drive different scheduler behaviour and must stay distinct.
- Keep `readiness()` synchronous and I/O-free — the scheduler calls it while planning.
- **Dispose every engine you create.** `createSearchEngine` is called per request by the host, and
  `dispose()` is the only thing that releases adapter-owned OS resources (the browser tier holds a
  sidecar process and a Chromium). A caller that skips it leaks one of each per request.
- Gate any adapter you reach for outside the normal wave on `entry.enabled`. `policy.lastResort` is
  the single documented exception — browser escalation is not one, or an operator who turned the
  most expensive tier off still pays for it.
- Parse HTML with `tokenizeHtml` (`src/extract/tokenizer.ts`). No new regex parsers.
- Any new public type on the adapter contract is a **contract change**: bump `CONTRACT_VERSION`
  (`src/contract/version.ts`) and follow `BACKWARD_COMPATIBILITY.md`, because third-party adapter
  packages compile against it.

## Never

- Never let a confidence threshold or domain cap produce an empty result set — relax and flag
  `degraded` instead (`src/fusion/fuse.ts`).
- Never trust an adapter to honour the contract. `runAdapter` converts a throw into an `error`
  outcome on purpose; do not remove that guard.
- Never put a vendor name in this package.

## Layout

| Path | Role |
|---|---|
| `src/contract/` | Adapter interface, outcomes, steps, policy, errors, `CONTRACT_VERSION` |
| `src/net/` | SSRF guard + the single hardened, DNS-pinned HTTP client |
| `src/extract/` | Linear HTML tokenizer, text, title, main-content, page classifier |
| `src/fusion/` | URL canonicalization, dedup, reciprocal-rank fusion, domain diversity |
| `src/engine/` | Wave scheduler, deadlines, browser escalation, single-flight, cache seam |
| `src/testing/` | `describeAdapterContract()` and fakes — published for third-party adapters |

## Design notes worth knowing before changing things

- **DNS pinning** (`createPinnedLookup`) is why the client is built on `node:https` rather than
  `fetch`: the connection must resolve to exactly the addresses the SSRF guard vetted, or the
  rebinding window between check and connect stays open.
- **`assertPublicUrl` fails closed on DNS failure by default**, unlike reference implementations that
  fail open. We pin, so no addresses means no pinning, and proceeding would silently drop a control.
- **RRF, not score blending** — an LLM citation list, a SERP and a paid API have no comparable score
  scale. Rank is the only signal they all agree on.
- **The soft deadline only binds once results exist.** With nothing in hand the scheduler keeps
  waiting to the hard deadline; holding back a usable answer for a straggler is the worse failure.
- **Browser escalation is decided here, in code**, from `classifyPage` — not by prompting the model,
  which costs a round-trip and answers differently each time.

## Validation

```bash
yarn workspace @open-mercato/web-research test
yarn workspace @open-mercato/web-research typecheck
yarn workspace @open-mercato/web-research build
```
