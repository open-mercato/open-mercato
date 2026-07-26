---
name: om-create-web-research-adapter
description: Scaffold a new web-research search adapter as its own npm workspace package — package.json with the `openMercato.webResearchAdapter` manifest, the `AdapterModule` descriptor and zod `optionsSchema`, an outcome-based `search()` routed through the hardened HTTP client, and the shared `describeAdapterContract` conformance suite. Use when adding a search source (Brave, Exa, Serper, Kagi, Mojeek, a self-hosted SearXNG, an internal index, a scraping vendor) to the `@open-mercato/web-research` engine. Triggers on "add web search adapter", "new search provider", "web-research adapter", "add Brave/Exa/Serper/Kagi search", "hook up a search API", "add a SERP engine", "search adapter package".
---

# Create a Web Research Adapter

Every search source in Open Mercato is a **separate npm workspace package** discovered from a
`package.json` manifest key. Adding one never requires touching the engine, `agent_orchestrator`,
or any registry by hand.

Read `packages/web-research/AGENTS.md` before starting. The three shipped adapters are your
references, one per shape:

| Shape | Reference | Use when |
|---|---|---|
| SERP scraping | `packages/web-research-serp` | The source returns HTML you must parse |
| Keyed JSON API | `packages/web-research-firecrawl` | The source has a REST API and a key |
| Host capability | `packages/web-research-model` | The source needs something only the app can supply (an LLM, a DB handle) |

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

### 3. Obey the four rules that actually matter

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

Also: honour `context.signal`, respect `request.limit`, and call `context.report(...)` at the
interesting moments — those lines are what the operator watches live.

### 4. Host capabilities the config cannot express

If the adapter needs something only the app can provide (an LLM, a tenant DB handle), declare it in
the same schema as a structural check and let the registry merge it in at instantiation:

```ts
resolveModel: z.custom<ModelResolver>((value) => typeof value === 'function').optional(),
```

`readiness()` then reports its absence plainly instead of failing deep inside a search. See
`packages/web-research-model/src/adapter.ts`.

If you must import an optional SDK, do it with a **dynamic import inside the call path**, never at
module scope. This package is statically imported by the generated registry, and a missing optional
peer at module scope fails the entire registry rather than just this adapter.

### 5. Test it

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

### 6. Wire and verify

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
- Never throw from `search`, `fetch`, or `readiness`.
- Never return `empty` for a failure, or `error` for a missing key.
- Never import an optional peer dependency at module scope.
- Never reuse an existing adapter id — the loader rejects the duplicate and the operator sees an adapter silently missing.
- Never bundle a copy of `@open-mercato/web-research`.
