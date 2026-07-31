# Standalone development-memory candidate verification

Date: 2026-07-31

Status: **FAIL — DONE_WITH_CONCERNS.** The functional, telemetry-path, and
post-edit cadence checks pass, but neither mandatory 30% peak-RSS gate passes.
The confirmed intervention must return to Task 2 attribution; no second
production change was formed or added.

## Environment and candidate identity

- Runner: local macOS host.
- Node: `v24.13.1`, selected by prepending
  `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin` to `PATH`.
- Yarn: `4.17.1`.
- Worktree:
  `/Users/andrzejewsky/work/open-mercato/.worktrees/standalone-dev-memory-30pct`,
  branch `codex/standalone-dev-memory-30pct`, candidate source commit
  `133f8d65483aacf4e11e4d6c7822f6ddb16da502`.
- Existing standalone fixture:
  `/tmp/open-mercato-standalone-memory-baseline`, canonicalized by macOS to
  `/private/tmp/open-mercato-standalone-memory-baseline`.
- Isolated registry: the existing no-uplink Verdaccio 6 container
  `standalone-memory-verdaccio-isolated` on host port `4875`. Its package
  catalog contained the same 21 public workspace packages at version `0.6.6`
  after the candidate publish.
- Isolated database: the existing `pgvector/pgvector:pg17-trixie` container
  `standalone-memory-postgres` on host port `5433`, database
  `open_mercato_standalone`. The database, app environment, module registration,
  and normal app-local dev workflow were not replaced or reinitialized.

## Build, publish, and fixture refresh

The required local Node 24 sequence completed successfully:

```bash
yarn build:packages
yarn generate
yarn build:packages
```

The first and second package builds each completed 21/21 tasks, and generation
completed 1/1. The shared `yarn registry:publish` script was deliberately not
used because it resets and starts the unrelated shared port-4873 registry.
Against only the existing isolated port-4875 registry, each of the 21 public
workspace packages was instead:

1. unpublished at exactly version `0.6.6`;
2. packed with `yarn pack --out package.tgz`;
3. published with `npm publish package.tgz --registry
   http://localhost:4875 --access public`.

All 21 packages republished, and the final isolated catalog count was 21.

The existing fixture then removed only reinstallable `node_modules`, disposable
`.mercato/next`, and its candidate-only empty cache. It installed through a
fresh fixture-local Yarn cache with:

```bash
YARN_ENABLE_GLOBAL_CACHE=false \
YARN_CACHE_FOLDER=/private/tmp/open-mercato-standalone-memory-baseline/.yarn/candidate-cache \
YARN_CHECKSUM_BEHAVIOR=update \
yarn install --refresh-lockfile
```

The install fetched 1,605 packages, retained all 18 fixture
`@open-mercato/*` dependencies at `0.6.6`, and completed with the existing peer
warning that the app does not provide `react-is`. Installed artifacts matched
the rebuilt workspace:

| Artifact | SHA-256 |
| --- | --- |
| workspace and installed `@open-mercato/cli/dist/mercato.js` | `1ab1296c0662b75263b2dd1141cca44178781c8603ec3b8c4c1c2b7f60a155fd` |
| workspace and installed `@open-mercato/shared/dist/lib/modules/resource-usage.js` | `4721fa4b63965c22c2a91282577c03f18e8e89801d749002742a3bda1f1e67ad` |

Installing packages cannot update scaffold-owned runtime scripts, so the
fixture's `scripts/dev.mjs` was replaced byte-for-byte from the committed
`packages/create-app/template/scripts/dev.mjs`. Both files have SHA-256
`7365eff3bc697d3a37c1213940e8ad001d7e73908f56a267b9ca8c28491ec3ee`.
The installed wrapper contains the managed default at lines 601–617 and resolves
it to:

```text
<app>/.mercato/next/module-resource-usage
```

No fixture env file declares `OM_MODULE_RESOURCE_USAGE_DIR`. Before and after
refresh and measurement, `.env` retained SHA-256
`54e2a4f05ab148e1d41e8b3f536221dac3d3e1750c48234609aad5da838ef5b3`,
`src/modules.ts` retained
`292ac9c4e519198ad157ff6843b16997ac7cb93160ef8a67cbff9b3e0c82ce52`,
and the final intended marker-B page retained its original
`bb1b3f26a3d4caf75ac8c7f84a5b4059aa80b362307e841a0133c9b8aae0b2ac`
hash.

## Measurement method

Each run started the actual standalone command from a fully stopped process
tree:

```bash
OM_DEV_AUTO_OPEN=0 yarn dev
```

`OM_DEV_AUTO_OPEN=0` suppresses only the compact splash's OS browser launch; the
normal compact runtime, splash server, migration check, artifact generation,
Next/Turbopack server, scheduler, and shared worker remained enabled. The
external profiler command for each root `yarn dev` PID was:

```bash
node scripts/profile-dev-rss.mjs \
  --pid <root-pid> \
  --label candidate-<N> \
  --duration 180000 \
  --interval 1000 \
  --out-dir /private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss
```

The operator used a fresh headed Playwright CLI session named `candidate1`,
`candidate2`, or `candidate3` for each run. The observed workflow opened
`http://localhost:3000/backend/memory-probe`, followed the login redirect,
authenticated as `superadmin@acme.com`, returned to the protected probe, and
found `Baseline marker A`. The operator then made the intended A-to-B edit in
`src/modules/memory_probe/backend/memory-probe/page.tsx`.

The independently inspectable browser evidence is narrower than that observed
workflow: every run retains an authenticated protected-page accessibility
snapshot with the `Memory probe` title, `superadmin@acme.com` control, and
marker A; a screenshot with marker B; and a console log containing the Fast
Refresh rebuild after the edit. The console logs continue past 180 seconds. No
browser trace or command transcript was retained, so exact redirect, login, and
negative navigation history are recorded as operator observations rather than
independently replayable evidence.

After each measurement the operator closed the browser, sent `Ctrl-C` to the
dev tree, observed `Shutting down services...`, confirmed ports 3000/4000 were
free, and restored marker A while stopped. The retained profiler reports prove
the root and Next server PIDs remained present in every sample through each
final approximately 179-second sample; later telemetry snapshots independently
retain the server PIDs. They do not retain a root-PID observation after the
full 180 seconds. After the final stopped run, the fixture was restored to its
intended marker B.

## Raw candidate results

The reduction columns use the fixed corrected baseline comparators:

- total peak: `10,094.50 MB`;
- mean total: `9,431.21 MB`;
- attributed `next-turbopack` per-run class maximum: `7,908.54 MB`.

Negative reduction is a regression.

| Run | Exact report | Samples | Peak total | Mean total | Total reduction | Mean reduction | Dominant class at total peak | Maximum `next-turbopack` class total in any sample | Attributed reduction | Top process at total peak |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| 1 | `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-1.json` | 172 | 10,611.17 MB | 6,656.76 MB | -5.118332% | 29.417752% | `next-turbopack` | 9,272.87 MB | -17.251351% | PID 19409, `next-server (v16.2.11)`, 8,833.23 MB |
| 2 | `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-2.json` | 173 | 10,396.86 MB | 5,657.47 MB | -2.995294% | 40.013317% | `next-turbopack` | 9,031.45 MB | -14.198702% | PID 22632, `next-server (v16.2.11)`, 8,411.98 MB |
| 3 | `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/candidate-3.json` | 173 | 9,758.31 MB | 6,329.72 MB | 3.330427% | 32.885388% | `next-turbopack` | 8,929.55 MB | -12.910221% | PID 25680, `next-server (v16.2.11)`, 7,926.23 MB |

Profiler windows were:

| Run | Root PID | Started UTC | Finished UTC | Total peak UTC | Maximum `next-turbopack` UTC |
| --- | ---: | --- | --- | --- | --- |
| 1 | 19304 | `2026-07-31T08:33:22.805Z` | `2026-07-31T08:36:22.806Z` | `2026-07-31T08:33:41.628Z` | `2026-07-31T08:33:41.628Z` |
| 2 | 22597 | `2026-07-31T08:38:43.341Z` | `2026-07-31T08:41:43.343Z` | `2026-07-31T08:38:50.606Z` | `2026-07-31T08:38:50.606Z` |
| 3 | 25642 | `2026-07-31T08:43:45.359Z` | `2026-07-31T08:46:45.362Z` | `2026-07-31T08:43:53.694Z` | `2026-07-31T08:43:51.631Z` |

The recorded timeline places all three total-tree peaks before interactive
browser work. Runs 1 and 2 peaked within the logged managed warmup window. In
run 3, the maximum `next-turbopack` class total occurred at
`08:43:51.631Z`, 52 ms before the logged `08:43:51.683Z` warmup completion,
while the total-tree peak occurred at `08:43:53.694Z`, 2.011 seconds after
completion. The supported lifecycle characterization is therefore a
startup/warmup-adjacent pre-browser peak, not that every peak occurred during
warmup. None was a post-edit invalidation peak.

## Functional, HMR, and PID evidence

The operator observed successful authentication and the protected A-to-B
workflow in all three runs. Independently retained A snapshots show the
protected `Memory probe` shell, `superadmin@acme.com` control, and marker A;
retained B screenshots show the refreshed marker B; and retained console logs
show the corresponding Fast Refresh activity. The two 401 console entries per
run are also retained, but the logs alone do not prove their exact navigation
cause.

| Run | Marker evidence retained below fixture `.mercato/dev-rss/browser/` | Root/server PID | Final profiler sample | Retained PID continuity |
| --- | --- | --- | --- | --- |
| 1 | `candidate-1-marker-a.yml`, `candidate-1-marker-b.png` | 19304 / 19409 | `2026-07-31T08:36:21.822Z` | Both present in all 172 samples |
| 2 | `candidate-2-marker-a.yml`, `candidate-2-marker-b.png` | 22597 / 22632 | `2026-07-31T08:41:42.647Z` | Both present in all 173 samples |
| 3 | `candidate-3-marker-a.yml`, `candidate-3-marker-b.png` | 25642 / 25680 | `2026-07-31T08:46:44.798Z` | Both present in all 173 samples |

## Browser console cadence

Exact retained consoles:

- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/browser/candidate-1-console.log`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/browser/candidate-2-console.log`
- `/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/browser/candidate-3-console.log`

The following are `[Fast Refresh] rebuilding` timestamps from the beginning of
each browser session, restricted to the first 180 seconds. The intended edit
event is bold.

| Run | First-180-second rebuild timestamps | Count | Post-edit timestamps | Three-event 4–6 s sequence after edit |
| --- | --- | ---: | --- | --- |
| 1 | 31.675 s, 32.257 s, 32.858 s, **66.416 s**, 151.182 s | 5 | 66.416 s, 151.182 s | None |
| 2 | 3.293 s, 17.084 s, **41.858 s**, 160.097 s | 4 | 41.858 s, 160.097 s | None |
| 3 | 3.004 s, 15.523 s, 16.002 s, 16.573 s, **36.897 s**, 159.158 s | 6 | 36.897 s, 159.158 s | None |

The median candidate count is 5 versus the baseline's 36, an 86.111111%
reduction. The confirmed five-second post-edit invalidation sequence is absent
from every candidate console.

## Managed telemetry path evidence

Fresh current-process snapshots were observed only below the new managed path:

| Run | Current-process snapshot PIDs below `.mercato/next/module-resource-usage` |
| --- | --- |
| 1 | 19409 (Next server), 19754 (scheduler), 19781 (shared worker) |
| 2 | 22632 (Next server), 22709 (scheduler), 22724 (shared worker) |
| 3 | 25680 (Next server), 25758 (scheduler), 25785 (shared worker) |

The candidate-3 Next snapshot was still advancing at
`2026-07-31T10:47:52+0200`. By contrast, the newest file below the watched old
`.mercato/module-resource-usage` path remained the pre-candidate
`process-76198.json` at `2026-07-30T23:18:36+0200` before, during, and after the
three runs. The managed telemetry-path behavior passes.

## Acceptance math

### Primary total-process-tree peak

```text
candidate median = median(10,611.17, 10,396.86, 9,758.31)
                 = 10,396.86 MB

reduction = (10,094.50 - 10,396.86) / 10,094.50
          = -0.029952944672841704
          = -2.995294%
```

This is a **2.995294% regression**, not a 30% reduction. The median is
`3,330.71 MB` above the fixed `7,066.15 MB` ceiling. **Primary gate: FAIL.**

### Attributed `next-turbopack` per-run class maximum

The same per-run maximum-across-all-samples definition was recomputed for both
baseline and candidate reports. Baseline maxima were `7,908.54`, `7,732.40`,
and `8,349.56 MB`, whose median is the fixed `7,908.54 MB` comparator.
Candidate maxima were:

```text
candidate median = median(9,272.87, 9,031.45, 8,929.55)
                 = 9,031.45 MB

reduction = (7,908.54 - 9,031.45) / 7,908.54
          = -0.14198701656690119
          = -14.198702%
```

This is a **14.198702% regression**. The median is `3,495.472 MB` above the
fixed `5,535.978 MB` ceiling. **Attributed gate: FAIL.**

The median top `next-server` value at the total-tree peak is `8,411.98 MB`,
14.760513% above the baseline median `7,330.03 MB` comparator defined the same
way.

## Secondary effects and new attribution

- Median total-process-tree **mean** is `6,329.72 MB`, a 32.885388% improvement
  from the `9,431.21 MB` baseline median mean. Sustained memory therefore
  improved even though the required peak worsened.
- Median Fast Refresh rebuild count improved by 86.111111%, and no periodic
  post-edit five-second sequence remains.
- Managed warmup durations printed by the unchanged runtime were 21.9 seconds,
  8.9 seconds, and 7.7 seconds. Run 1 followed the required fresh package and
  `.mercato/next` refresh; runs 2 and 3 reused the resulting compiler cache.
- Every total-tree peak preceded interactive browser work and had
  `next-turbopack` as its dominant class. At those total-tree peaks,
  `next-server` alone used 7,926.23–8,833.23 MB. The intervention removes
  sustained filesystem invalidation but does not reduce the retained
  startup/warmup-adjacent pre-browser memory peak.

## Verdict and next action

| Requirement | Result |
| --- | --- |
| Rebuilt and republished candidate packages to isolated Verdaccio | Pass |
| Existing fixture/database/module/environment retained | Pass |
| Candidate template wrapper installed and hashed | Pass |
| Fresh snapshots use `.mercato/next/module-resource-usage` | Pass |
| Three complete 180-second, 1-second-interval reports | Pass |
| Login and protected page render observed on every run, corroborated by protected A snapshots | Pass |
| A-to-B refresh observed; B screenshots and Fast Refresh consoles retained | Pass |
| Root and server PIDs present in every profiler sample through the final approximately 179-second sample | Pass |
| No post-edit sequence of three rebuilds spaced 4–6 seconds | Pass |
| Median total peak at least 30% below baseline | **Fail** |
| Median attributed `next-turbopack` per-run class maximum at least 30% below baseline | **Fail** |

**Overall: FAIL / DONE_WITH_CONCERNS.** Per the Task 4 gate, acceptance is not
weakened and no additional change is stacked. Return to Task 2 root-cause
attribution using the repeatable startup/warmup-adjacent pre-browser memory
peak and its 7.9–8.8 GB `next-server` owner at the total-tree peak as the next
evidence boundary.
