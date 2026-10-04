---
name: om-create-web-research-adapter
description: Scaffold a new web-research search adapter as its own npm workspace package — package.json with the `openMercato.webResearchAdapter` manifest, the `AdapterModule` descriptor and zod `optionsSchema`, an outcome-based `search()` routed through the hardened HTTP client, and the shared `describeAdapterContract` conformance suite. Use when adding a search source (Brave, Exa, Serper, Kagi, Mojeek, a self-hosted SearXNG, an internal index, a scraping vendor) to the `@open-mercato/web-research` engine. Triggers on "add web search adapter", "new search provider", "web-research adapter", "add Brave/Exa/Serper/Kagi search", "hook up a search API", "add a SERP engine", "search adapter package".
---

# Create a Web Research Adapter

Every search source in Open Mercato is a **separate npm workspace package** discovered from a
`package.json` manifest key. Adding one never requires touching the engine, `agent_orchestrator`,
or any registry by hand.

Read `packages/web-research/AGENTS.md` before starting. Pick the shipped adapter closest to your
shape and work from it:

| Shape | Reference | Use when |
|---|---|---|
| SERP scraping | `packages/web-research-serp` | The source returns HTML you must parse |
| Keyed JSON API | `packages/web-research-tavily`, `packages/web-research-firecrawl` | The source has a REST API and a key |
| Operator-hosted endpoint | `packages/web-research-searxng` | The operator runs the service themselves — **read the egress trap in step 3 first** |
| Host capability | `packages/web-research-model` | The source needs something only the app can supply (an LLM, a DB handle) |
| Owns a process | `packages/web-research-browser` | The adapter holds an OS resource — read step 4 on lifecycle |

## Steps

### 1. Create the package

`packages/web-research-<vendor>/`. Copy `package.json`, `tsconfig.json`, `build.mjs`, `watch.mjs`
and `jest.config.cjs` from the closest reference above and change the name. Three things matter:

```json
{
  "name": "@open-mercato/web-research-<vendor>",
  "version": "0.6.5",
  "openMercato": { "webResearchAdapter": { "id": "<adapter-id>" } },
  "peerDependencies": { "@open-mercato/web-research": "^0.6.0" }
}
```

- `version` **must** equal `packages/shared/package.json`'s version or `scripts/check-version-alignment.sh` fails the release.
- `contractVersion` on the descriptor is checked against a supported range, not an exact value, so an additive engine bump does not disable your package. Always declare `CONTRACT_VERSION` from the engine you compiled against.
- The `openMercato.webResearchAdapter.id` is what the generator scans for and must match the `id` on the descriptor.
- Keep `@open-mercato/web-research` a **peer** dependency plus a `workspace:*` dev dependency. Two copies of the engine means two `CONTRACT_VERSION` constants.
- `jest.config.cjs` needs the `moduleNameMapper` pointing `@open-mercato/web-research` at `../web-research/src`.

### 2. Write the adapter

```ts
export const <vendor>OptionsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
})

export function create<Vendor>Adapter(options: <Vendor>Options): SearchAdapter {
  return {
    id: '<adapter-id>',
    kind: 'api',            // 'serp' | 'api' | 'model' | 'browser'
    capabilities: { search: true, fetch: false, snippets: true, content: false,
                    freshness: false, siteFilter: true, cost: 'metered' },
    readiness: () => (apiKey ? READY : notReady('<Vendor> API key is not set')),
    async search(request, context) { /* … */ },
  }
}

export const <vendor>AdapterModule = defineAdapterModule({
  id: '<adapter-id>',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: <vendor>OptionsSchema,
  createAdapter: create<Vendor>Adapter,
})
```

Export the descriptor as **both** a named export and the default from `src/index.ts`.

**Your `optionsSchema` is the admin form.** `describeOptionsSchema` reflects over it to render
**Agents → Web search**, and it only understands `string`, `number`, `boolean`, `enum` and
`string[]` (plus those wrapped in `.optional()` / `.nullable()` / `.default()`). Anything else —
a nested `z.object`, a union, a tuple, a record — is **silently dropped from the form**, so the
operator gets no field and no error. Keep options flat; flatten `retry.attempts` to `retryAttempts`
rather than nesting it.

**Credential fields are masked by name, not by type.** `apiKey`, `api_key`, `accessToken`,
`secret`, `password`, `credential` and their plurals are recognised and replaced with a placeholder
before the settings API answers the browser. A key named `bearer`, `pat`, `licence` or `authCode`
matches nothing and is **echoed back to every user who can view the settings page**. Name the field
so it matches, and assert it in a test:

```ts
expect(describeOptionsSchema(<vendor>AdapterModule).find((f) => f.name === 'apiKey')?.secret).toBe(true)
```

Be aware of where the value lands: adapter options are persisted through `moduleConfigService`,
which does **not** encrypt them at rest today. Treat a stored key as readable by anyone with
database access, and prefer an option that reads from env over one that stores a long-lived
credential when the vendor supports it.

### 3. Obey the rules that actually matter

These are not style preferences — the scheduler's behaviour depends on each one.

**Never throw.** Wrap the body and return `toOutcomeFailure(error)`. A throw is caught by
`runAdapter` and reported as `error`, but you lose the distinction that drives everything else.

**Return the right outcome.** They are not interchangeable:

| Outcome | Means | Scheduler does |
|---|---|---|
| `ok` | Results (or a prose `answer`) | Counts toward quorum |
| `empty` | Source worked, genuinely nothing matched | Accepts it as an answer |
| `unavailable` | Not configured, no key, wrong provider | Demotes it for the run |
| `blocked` | 429, captcha, challenge page, **markup you can no longer parse** | Escalates to the browser tier |
| `timeout` | Deadline or abort | Nothing further |
| `error` | Anything else; set `retriable` honestly | Retries only when retriable |

A SERP adapter that gets a large page and parses zero results must return `blocked`, not `empty` —
see `packages/web-research-serp/src/adapter.ts`. `empty` would let a stale selector return nothing
forever without anyone noticing.

**Use `context.http`, never `fetch`.** The SSRF guard, DNS pinning, redirect re-validation, byte
caps, content-type gating and per-host politeness all live there. An SDK that does its own
networking bypasses every one of them — prefer calling the vendor's REST endpoint through
`context.http` over importing their client library.

**Keep `readiness()` synchronous and I/O-free.** The scheduler calls it while planning a wave.

Also: respect `request.limit` and call `context.report(...)` at the interesting moments — those
lines are what the operator watches live.

**Honour `context.deadlineAt`, not just `context.signal`.** The signal tells you when the engine
has given up; `deadlineAt` tells you how much budget you had, so you can size your own timeouts
under it. An adapter with a hardcoded 30s timeout inside an 8s budget does not fail faster — it
keeps working, and keeps whatever it holds open, long after nobody is listening. Derive every
internal timeout from `Math.max(0, context.deadlineAt - Date.now())`.

**The SSRF guard blocks private, loopback and link-local targets by default.** This is the one that
surprises people: an adapter for a service the operator runs themselves at `http://searxng:8080`
cannot reach it out of the box. `context.http` fails closed on every private address, on every
redirect hop, and on a hostname that resolves to one.

The escape hatch is `allowPrivateHosts` on the client — an allowlist of hosts permitted to resolve
privately, matched on exact host or a dot-boundary suffix, empty unless an operator fills it. It is
deliberately not a boolean: "allow private" would open every internal address to whatever URL a
model or a search result happens to produce. **You do not set it**; the host builds the client. If
your adapter's `baseUrl` normally points inside the deployment's own network, say so in the field
description and in your README so the operator knows to name that host.

### 4. Lifecycle and the cost of a health check

**The engine is built per request and disposed after it.** `agent_orchestrator` constructs a fresh
engine for every `web_search`, every `web_fetch` and every load of the settings page, then calls
`engine.dispose()`, which calls yours. Two consequences:

- **Anything you allocate outside a single call must be released in `dispose()`** — a child
  process, a socket, a browser, an interval. Nothing else will ever release it, and a leak here is
  one leaked resource *per agent tool call*, not one per boot. `dispose()` must be safe to call
  when the adapter was never used, and safe to call twice.
- **Construction must stay cheap and lazy.** `createAdapter(options)` runs on every request, and on
  a settings page render for every installed adapter, whether or not it is enabled. Do the
  expensive part on first use, the way `web-research-browser` defers spawning its sidecar.

**`healthCheck()` must be cheap, and it must not be billable.** It runs whenever an operator opens
or refreshes **Agents → Web search**, once per installed adapter. Prefer a dedicated status or
quota endpoint. If the vendor has none, prefer reporting `ok` from configuration alone over
spending a metered search on a probe nobody asked for — a health check that quietly bills the
tenant for every page view is worse than no health check. Say which one you chose in the package
README.

Note that `healthCheck` runs for every installed adapter, not just enabled ones, so "the operator
turned this off" does not protect them from its cost.

### 5. Host capabilities the config cannot express

If the adapter needs something only the app can provide (an LLM, a tenant DB handle), declare it in
the same schema as a structural check and let the registry merge it in at instantiation:

```ts
resolveModel: z.custom<ModelResolver>((value) => typeof value === 'function').optional(),
```

`readiness()` then reports its absence plainly instead of failing deep inside a search. See
`packages/web-research-model/src/adapter.ts`.

**Ship what your adapter needs.** Declare an SDK your adapter cannot work without as a real
`dependency`, not an optional peer — installing the adapter package should be the only step an
operator takes. The package is opt-in by virtue of being installed at all, so there is nothing to
protect a non-user from.

Still import it with a **dynamic import inside the call path**, never at module scope: this package
is statically imported by the generated registry, and a load failure at module scope fails the whole
registry rather than just this adapter.

**Non-npm assets need a bootstrap.** A browser binary, a model file or a native toolchain is not
something the package manager fetches. Handle it the way `web-research-browser` handles Chromium:
detect the specific "asset missing" failure, fetch it once with a bounded timeout, retry exactly
once, and surface an actionable error if the fetch fails. Keep the fetcher injectable so tests never
shell out. Until a second adapter needs this, keep it inside the adapter rather than generalizing it.

### 6. Test it

Run the shared conformance suite plus your own behaviour tests:

```ts
describeAdapterContract(
  <vendor>AdapterModule,
  {
    unconfiguredOptions: {},                       // omit only if it needs no config
    configuredOptions: { apiKey: 'test-key' },
    context: () => createTestContext({ http: createStubHttpClient(() => ({ body: FIXTURE })) }),
  },
  { describe, it, expect: expect as never },
)
```

`createStubHttpClient` also proves you routed egress correctly: an adapter that reaches for `fetch`
passes its own tests while making real network calls, and the stub's `calls` array stays empty.

Cover at least: unconfigured is `unavailable` and makes no call; a real fixture maps to results;
a malformed payload is `error` not a crash; the vendor's "no hits" is `empty`; `limit`, `site` and
`freshness` reach the request. For a SERP adapter add a golden HTML fixture and a nested-inline-
markup case — that is where parsers break.

If your adapter holds anything, also cover: `dispose()` on an adapter that was never used is a
no-op rather than a throw, `dispose()` twice is safe, and every field the settings page must render
survives `describeOptionsSchema` (see step 2 — a nested object disappears silently, and a test is
the only thing that catches it).

### 7. Wire and verify

```bash
yarn install                                        # register the workspace
yarn workspace @open-mercato/web-research-<vendor> typecheck
yarn workspace @open-mercato/web-research-<vendor> test
yarn build:packages
yarn generate                                       # regenerates the adapter registry
```

Confirm your package appears in `apps/mercato/.mercato/generated/web-research-adapters.generated.ts`.
If it does not, the manifest key is wrong or `yarn install` did not link the workspace.

The adapter then shows up in the agent_orchestrator web-search settings page with a form rendered
from your `optionsSchema`. It ships **disabled** — enabling it is the operator's call.

## Never

- Never call `fetch`, `node:https`, or a vendor SDK's own transport.
- Never throw from `search`, `fetch`, `readiness`, or `dispose`.
- Never return `empty` for a failure, or `error` for a missing key.
- Never import an SDK at module scope, even one you depend on - the generated registry imports this package statically.
- Never reuse an existing adapter id — the loader rejects the duplicate and the operator sees an adapter silently missing.
- Never bundle a copy of `@open-mercato/web-research`.
- Never allocate a process, socket or browser in `createAdapter` — it runs per request, and per installed adapter on every settings page load.
- Never spend a metered call in `healthCheck()`; it runs on every settings page load, for every installed adapter, enabled or not.
- Never let an internal timeout outlive `context.deadlineAt`.
