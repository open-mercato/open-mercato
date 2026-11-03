# Issue #8211: AI assistant root type resolution

The root export pointed at `./dist/index.js` with no declaration sibling. The fix adds `types: ./src/index.ts` before the unchanged `default: ./dist/index.js`; `main`, all subpaths, dependencies and runtime exports stay unchanged.

## Regression evidence

`yarn install --immutable` passed. Runner: local (no compose app running). Host Node v26.12.1, Yarn 4.18.1; CI targets Node 24.

`yarn workspace @open-mercato/ai-assistant test --runInBand --runTestsByPath src/__tests__/package-exports.test.ts`: 2 failed before fix; 2 passed after fix, including after package build. The test uses actual `npm pack --ignore-scripts --json` output extracted into a temporary consumer node_modules, without tsconfig paths or module mocks. TypeScript resolver runs in Bundler and NodeNext modes. Temporary files are removed in finally.

A second controlled experiment changed only the extracted manifest, retaining the same built tarball files:

| Root mapping | Bundler result | NodeNext result |
| --- | --- | --- |
| Original bare string | dist/index.js (.js) | dist/index.js (.js) |
| Added types condition | src/index.ts (.ts) | src/index.ts (.ts) |

The tarball contained dist/index.js and src/index.ts, with no dist/index.d.ts. This verifies root type selection, not semantic compilation of every transitive source dependency or a complete fresh Discord scaffold.

`yarn workspace @open-mercato/ai-assistant test --runInBand`: **133 suites / 1803 tests passed**.

## Configured gate

Every configured command was attempted in order, with a per-command timeout and cleanup of its process group.

| Command | Result |
| --- | --- |
| yarn build:packages | PASS, 42 tasks |
| yarn generate | PASS |
| yarn build:packages (second) | PASS |
| yarn i18n:check-sync | Initial EINVAL: cockpit TMPDIR exceeds Unix socket length; PASS with TMPDIR=/tmp |
| yarn i18n:check-usage | Initial same EINVAL; retry with TMPDIR=/tmp exceeded 60-second bound |
| yarn typecheck | PASS, 42 tasks |
| yarn test | TIMEOUT, incomplete (30/49 tasks successful when terminated) |
| yarn build:app | PASS, optimized production build and TypeScript completed |

`yarn template:sync` and `git diff --check` passed. No generated source files changed. Full gate is **not green**; merge approval is withheld until remaining validation succeeds. A complete create-mercato-app + channel-discord installation/build was not run.

## Compatibility and scope

This restores the existing root entry's typing and preserves its runtime resolution, consistent with the existing subpath conditions and search/queue package pattern. Existing Discord integration spec: `.ai/specs/2026-06-19-discord-communication-channel-integration.md`, Migration & Backward Compatibility. No API shape, DB schema, permission or behavior change. Core/shared root alignment and release/backport decisions remain outside this task.
