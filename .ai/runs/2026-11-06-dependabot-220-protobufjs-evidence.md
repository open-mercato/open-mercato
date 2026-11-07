# Alert remediation evidence — 2026-11-06

## Source and deduplication

Authenticated paginated GitHub requests to `repos/open-mercato/open-mercato/dependabot/alerts?state=open&per_page=100` and `repos/open-mercato/open-mercato/code-scanning/alerts?state=open&per_page=100` succeeded: 21 dependency alerts and 2 CodeQL alerts. Latest main at selection: df20d84e8581643ba81f211281a7da3fbbccb332. Open PRs, recent merged PRs, in-progress issue/PR claims and the security automations were inspected. No repository advisory was independently selected. No issue was created or alert dismissed.

Selected identity: `dependabot:open-mercato/open-mercato:220`, `GHSA-j3f2-48v5-ccww`, `npm:protobufjs`, `yarn.lock`. Existing merged PR #3107 fixed an older advisory with 7.6.4; no open matching fix existed before this run opened #8857.

## Before and after proof

- Main has protobufjs 7.6.4 in its root resolution and lockfile.
- `timeout 300 yarn install --mode=update-lockfile`: exit 0; Yarn 4.17.1 generated only the protobufjs locator/version/checksum change.
- `timeout 300 yarn install --immutable`: exit 0 with existing peer warnings and native better-sqlite3/cpu-features build warnings. No age-gate bypass. Target 7.6.5 published 2026-07-04T01:13:19.092Z, older than five days.
- `timeout 30 yarn why protobufjs`: all eight listed consumer locators resolve 7.6.5: Firestore, three grpc/proto-loader versions, two dockerode versions, google-gax, proto3-json-serializer. Existing parent ranges accept this patch; existing security pin is updated rather than adding a new broad override.
- Installed `require('protobufjs/package.json').version`: 7.6.5.
- npm registry bulk advisory endpoint POST with `{"protobufjs":["7.6.4"]}` returns GHSA-j3f2-48v5-ccww (`>=7.5.0 <=7.6.4`); identical request for 7.6.5 returns `{}`. This directly verifies removal of the target vulnerability, independently of baseline-tolerant CI.
- `timeout 30 node --test scripts/__tests__/protobufjs-security.test.mjs`: 2 passed, including process-isolated malformed-option parsing with a five-second bound. The lockfile test against copies of main's manifest and lock fails (`7.6.4 !== 7.6.5`).
- Actual vulnerable-package reproduction from the cached 7.6.4 archive: `timeout 3 node` parsing `syntax = "proto3"; option unfinished` exits 124 (infinite loop). Patched 7.6.5 immediately throws an illegal-end-of-input error for three truncated-option variants.
- Installed protobufjs parse/create/encode/decode round-trip for a proto3 message containing string and uint32 fields: passed.
- `timeout 30 yarn check:resolutions`: passed, 30 descriptor-keyed resolutions match; 44 range-less pins.
- `git diff --check`: passed.

## Other source dispositions

Counts across 23 source alerts: 1 selected, 10 skipped because existing remediation PRs own them, 4 blocked, 8 deferred because all eligible groups share the root lockfile scope. No independent second worktree with disjoint manifest scope was available. Highest source severity was medium.

| Source alerts | Disposition and reason |
| --- | --- |
| 497,318,308 (`qs`) | Skip active PR #8809. |
| 480,479,478,477,398 (`fast-uri`) | Skip active PR #8778. |
| CodeQL 199,200 (Storybook source construction) | Skip existing PR #8747 and active continuation claim. |
| 543 (`minimatch`, GHSA-g3hv-75wg-m249) | Blocked: patched 11.x falls outside multiple parent ranges; no broad major override authorized. Retry with compatible parent updates or explicit compatibility decision. |
| 541 (`glob`, GHSA-3g3m-2fjr-6pw4) | Blocked: direct 14.0.3 already patched, remaining parent ranges constrain 10/11/13. Retry when parent upgrades accept patched 14.x. |
| 508 (`deepmerge`, GHSA-gcqx-w48m-w2h4) | Blocked: alert API provides no patched version. Retry on upstream patch. |
| 413 (`katex`, GHSA-238p-pmpm-9mq7) | Blocked: patched 0.18.2 outside Mermaid's ^0.16.47 range. Retry with compatible parent update. |
| 509,298 (`@hono/node-server`) | Deferred shared lockfile scope; SDK accepts patched 2.1.3. |
| 492,301 (`postcss-selector-parser`),284 (`postcss`) | Deferred shared lockfile scope; compatible CSS group should use selector-parser 7.1.6 and postcss >=8.5.27 to respect current minimum parent ranges. |
| 485 (`serialize-javascript`),378 (`moment`),310 (`@humanfs/node`) | Deferred shared lockfile scope; mature compatible targets 7.1.3,2.31.0,0.16.8 respectively. |

These are triage results, not claims that any alert is fixed on main. Future runs must recheck main and live claims.

## Ordered validation

Runner: local. No running compose app found; fullapp compose interpolation also requires an unavailable JWT_SECRET. Initial commands 1–3 passed. Initial i18n commands failed because the inherited long TMPDIR exceeded Unix socket path limits (`listen EINVAL`); typecheck also reported inability to spawn a child. Restarted the entire configured sequence with `TMPDIR=/tmp/om-ba1 TURBO_ENV_MODE=loose`, retaining command order and 600-second per-command timeouts. Final results follow after completion.

Integration coverage is explicitly requested through `ci-full`; `needs-qa` remains a merge gate. No approval label is granted by this evidence.
