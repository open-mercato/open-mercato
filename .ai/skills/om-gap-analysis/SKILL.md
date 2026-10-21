> **Repo-local override.** Supplies the Open Mercato platform profile and managed-checkout rules to the base skill's step 1 (platform profile), Phase 2 preflight, and artifact handling.

## Step 1 — platform profile (add: knowledge source 1; config `platform.*` still wins)

### Platform facts

| Fact | Value |
|---|---|
| repo | open-mercato/open-mercato |
| integration-branch | develop |
| companion-repo | open-mercato/official-modules |
| specs-path | .ai/specs:.ai/specs/enterprise |

- `develop` is the integration branch; `main` carries only release-ready code (`CONTRIBUTING.md`), so grounding against it undercounts.
- `open-mercato/official-modules` backs the optional `external/official-modules/` submodule (`.ai/docs/official-modules.md`); a merged module there is real coverage. The preflight uses the platform branch for the companion too; if that fails it degrades to `UNAVAILABLE`. Report it; never switch the platform branch to suit the companion.
- `.ai/specs/` = open-source specs, `.ai/specs/enterprise/` = commercial (`.ai/specs/AGENTS.md`). Specs under `implemented/` are shipped: never cite them as Upstream pipeline.

### License tiers

| Path prefix | Tier |
|---|---|
| packages/enterprise/ | enterprise |

Everything else is the open-source tier; `@open-mercato/enterprise` needs a commercial license for production (`packages/enterprise/LICENSE.md`).

## Phase 2 — orientation preflight checkouts (add)

- When `platform.cloneUrl` / `platform.companionCloneUrl` are unset, pass `--clone-url https://github.com/open-mercato/open-mercato.git` and `--companion-clone-url https://github.com/open-mercato/official-modules.git`.
- Never list this working tree (or `external/official-modules/`) as a checkout candidate unless the user asks: the preflight fast-forwards accepted candidates. Use its managed checkouts under the gitignored `.ai/tmp/om-gap-analysis/`.

## Where artifacts live (add)

This repository is public: never commit client documents or `.ai/gap-analysis/` outputs here. Run engagements from a separate workspace (base `references/engagement-workflow.md`); inside this repo, use single-capability mode only.
