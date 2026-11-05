# Step 3.1 — validation gate

Runner: **local** (no Docker on the host). The repo requires Node 24; the host ships Node 22, so the gate ran on
the official Node 24.21.0 linux-arm64 build (SHA-256 verified against nodejs.org `SHASUMS256.txt`).

| Command | Result |
|---|---|
| `yarn install --immutable` | 0 |
| `yarn build:packages` | 0 |
| `yarn generate` | 0 |
| `yarn build:packages` | 0 |
| `yarn i18n:check-sync` | 0 |
| `yarn i18n:check-usage` | 0 (advisory unused-key list only) |
| `yarn typecheck` | 0 — 0 TS errors |
| `yarn test` (`turbo run test --continue`, jest `--maxWorkers=3`) | 45/47 packages pass; core 18884 passed / 0 failed |
| `yarn build:app` | 0 |

The two failing test packages are untouched by this branch (no file under `packages/cli` or `packages/create-app` changes); their failures are not re-run against base, and look environmental:

- `@open-mercato/cli` `agent-files-extension.test.ts:609` — expects a "Could not resolve an output root" warning;
  this worktree sits nested inside another checkout, so an output root resolves.
- `create-mercato-app` `source-link-inventory` — "gallery and foundation baselines must be ancestors of the
  generated inventory", a git-ancestry check on design-gallery baselines in this worktree's history.

Workflows module suite alone (`jest src/modules/workflows`): 297 suites / 3734 tests pass. After rebasing onto
`origin/develop` (b4938566b) the touched suites were re-run: 5 suites / 249 tests pass.
