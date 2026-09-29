> **Repo-local override.** This file extends the external `om-auto-update-changelog` skill for Open Mercato release preparation. The external workflow remains authoritative except where this override explicitly broadens the release artifact set or corrects a release-window / credit-resolution default that is wrong for this repository.

# Open Mercato release-upgrade companion contract

Open Mercato releases must keep `CHANGELOG.md`, `UPGRADE_NOTES.md`, and version-specific downstream migration skills aligned. Apply this contract after the external skill resolves `{version}`, `{date}`, and the previous changelog release, but before it edits files or delegates to `om-auto-create-pr`.

## 1. Resolve the matching upgrade window

Read `UPGRADE_NOTES.md` and parse headings shaped as:

```text
## <from> → <to> (<date-or-unreleased>)
```

The candidate for the release is the section whose `<from>` equals the changelog release immediately below `{version}`. Comparison is semantic-version equality, not substring matching.

- No candidate means this release has no downstream upgrade notes. Continue with the external changelog-only workflow.
- Exactly one candidate means the section belongs to this release. Set `<to>` to `{version}` and replace `(unreleased)` with `({date})`. An already aligned heading is an idempotent no-op.
- More than one candidate, or a second section already targeting `{version}`, is ambiguous. Stop before edits and report the conflicting headings.

Never rewrite older dated windows or a future window whose `<from>` is not the previous changelog release. On an amend run for an existing top changelog release, use the next heading as the previous release and apply the same rule.

## 2. Require the version-specific companion skill

When a matching upgrade-note section exists, derive:

```text
om-auto-upgrade-<from>-to-<version>
```

Before delegating the release PR, require all four artifacts:

1. `.ai/skills/<skill>/SKILL.md` in the monorepo.
2. `packages/create-app/agentic/shared/ai/skills/<skill>/SKILL.md` as a byte-identical standalone harness copy.
3. `<skill>` in `.ai/skills/tiers.json` under `migration`.
4. `<skill>` in `packages/create-app/agentic/shared/ai/skills/tiers.json` under `migration`.

If any artifact is missing, create or repair the complete set in the same release PR. Build the skill only from the matching `UPGRADE_NOTES.md` section and classify every downstream action as one of:

- **Automatic:** a bounded, unambiguous, idempotent source edit.
- **Detect and report:** a reliable search exists but user intent is needed to change code safely.
- **No code action:** the note changes runtime behavior or operations only; explain it in the final report.

The skill must validate that it is running in a downstream app, support `--path` and `--dry-run`, avoid framework-owned `packages/` and generated/vendor directories, show its edit plan before mutation, run the app's configured typecheck/tests after edits, and list unresolved manual work. A release section with no safe automatic edit still gets a companion skill: discoverability and a deterministic review checklist are part of the contract.

Update `.ai/skills/README.md` and `.ai/skills/om-help/references/skills-catalog.md` for the new migration skill. Do not add version-specific skills to the default tier.

## 3. Broaden the delegated PR safely

For a release with matching upgrade notes, the external skill's `CHANGELOG.md`-only restriction is replaced by this exact allow-list:

- `CHANGELOG.md`
- `UPGRADE_NOTES.md`
- `.ai/skills/om-auto-upgrade-<from>-to-<version>/**`
- `packages/create-app/agentic/shared/ai/skills/om-auto-upgrade-<from>-to-<version>/**`
- `.ai/skills/tiers.json`
- `packages/create-app/agentic/shared/ai/skills/tiers.json`
- `.ai/skills/README.md`
- `.ai/skills/om-help/references/skills-catalog.md`
- tests/specs that enforce this release contract

Pass the expanded file list and the upgrade-window facts in the concrete `om-auto-create-pr` brief. The resulting PR is still non-UI and uses `skip-qa`, but it is a release-automation feature rather than a changelog-only documentation change.

With `--dry-run`, print the proposed heading reconciliation, companion-skill path/status, action classification, and both tier registrations without editing any file or invoking `om-auto-create-pr`.

## 4. Verification

Before delegating, run the smallest focused checks available:

```text
bash scripts/validate-skills-tiers.sh
yarn workspace create-mercato-app test
```

The delegated `om-auto-create-pr` run still owns the configured full validation and review gate. Do not claim the release artifacts are aligned until monorepo/standalone byte identity and both migration-tier registrations pass.

---

# Open Mercato release window and credit contract

Two of the external skill's defaults are wrong for this repository, and both have already shipped a wrong changelog. Apply this part on every run, in addition to the upgrade-companion contract above.

## Window: enumerate by reachability from `main`, not by base branch

The release tag and the release entry describe what is on `main`. `develop` runs well ahead of it. Never build the window from a `baseRefName` filter.

```bash
git fetch origin main --tags
LAST_TAG=$(git describe --tags --abbrev=0 origin/main)   # e.g. v0.6.6
git rev-list "$LAST_TAG..origin/main" > /tmp/window-commits.txt
```

The ordering and the explicit committish both matter. Fetch **before** resolving the tag: an agent commonly starts from a fresh worktree or a clone that has not fetched since the release was cut, and resolving first leaves `LAST_TAG` on the *previous* release, so the window spans two releases and re-lists shipped work. Pass `origin/main` explicitly, because a bare `git describe` describes `HEAD` — on a `develop` checkout that only agrees with `main` when a `chore: sync back main` has already landed, which is the very kind of PR this file tells you to exclude two rules below.

Then enumerate merged PRs for the calendar window across **all** base branches, and keep only those whose `mergeCommit.oid` appears in `window-commits.txt`. Request `mergeCommit` in the JSON field list; it is not in the shared skill's default field set.

Chunk the window by date and dedupe by PR number. `gh pr list` paginates internally, so `--limit` is honoured well past 250 — the real ceiling is the GitHub **Search API's 1000-result cap**, which a `--search` form hits silently. Always pass a `--limit` above the count you expect and treat a result whose length equals the limit as truncated, not complete.

Start the calendar window a few days **before** the previous release date. Develop PRs merged shortly before the release cut land on `main` with it, and a window that starts at the tag date silently drops them.

Additional exclusions on top of the shared skill's (runs-only and prior changelog PRs):

- Branch-sync and release plumbing — titles matching `^chore:\s*(sync back main|sync develop with main|prepare main for release)$`. The changelog has never listed these.
- Any PR already credited in an earlier `CHANGELOG.md` entry. **Match the reference slot only** — the final parenthesised group of a bullet, immediately before the optional `*(@author)*` credit — never a bare `#N` anywhere in the file. Take *every* number out of that group rather than assuming a comma-separated list, because real slots also use other separators and trailing prose:

  ```js
  // per bullet line; every number in the final parenthesised group is credited
  const slot = /\(([^)]*#\d+[^)]*)\)(?: \*\([^)]*\)\*)?\s*$/.exec(line)
  const credited = slot ? [...slot[1].matchAll(/#(\d+)/g)].map((m) => m[1]) : []
  ```

  A bare-number search cannot tell a credited bullet from a passing mention inside someone else's bullet text, and silently deletes a real release entry along with its author's credit. A strict `(#N, #N)` shape has the opposite failure — it under-matches, so an already-credited PR is listed twice. Both regexes were run over the current `CHANGELOG.md` (2360 bullets): the strict shape recognises 1956 slots, this one recognises 1961 and misses none of the strict set. The five it adds are slash-separated and prose-carrying slots this repository already writes — `(#1981 / #2055)`, `(#1981 / #2055 Phase 14)`, `(#2055, enterprise follow-up #2232)` — which would otherwise leave `#1981`, `#2055` and `#2232` unrecognised as credited.

  > Real failure this rule exists to prevent: `#3799` (`feat(auth): add demo autologin via env vars`, `@jtomaszewski`) was dropped from the 0.6.7 entry because the string `#3799` appears in the 0.6.6 bullet *"Close template-sync gap that let PR #3799 ship unsynced. (#3802)"* — which credits `#3802`, not `#3799`. The feature shipped with no changelog line and its author uncredited. Re-running the corrected match over the same 163-PR window excludes **nothing**: no window PR was genuinely credited earlier.

- Sub-PRs merged into an intermediate feature branch are **not** excluded automatically — see the umbrella rule below.

**Every exclusion must be justified per PR in the changelog PR body.** The window check verifies what is present and which PRs are absent, but not *why* an absence is acceptable — and that unchecked prose is exactly where the `#3799` error lived. List each excluded number with its reason so a reviewer can falsify it.

## Credit resolution — three additional paths and a verification pass

Apply the shared skill's Supersede Credit Rule Paths A/B/C first. Then apply these. When several paths fire, the earliest-lettered one wins (A > B > C > D > E).

### Path D — umbrella / feature-branch merge

A PR that merges a long-lived feature branch is authored by whoever pressed the button, not by whoever wrote the code. Detect it from commit authorship:

```bash
TOTAL=$(gh api graphql -f query="{ repository(owner:\"open-mercato\",name:\"open-mercato\"){ pullRequest(number:$PR){ commits { totalCount } } } }" \
  -q '.data.repository.pullRequest.commits.totalCount')
gh api --paginate "repos/open-mercato/open-mercato/pulls/$PR/commits" \
  --jq '.[] | select((.parents | length) < 2) | (.author.login // .commit.author.name)' \
  | sort | uniq -c | sort -rn
```

**Never tally from `gh pr view --json commits`.** It returns at most 100 commits and reports no truncation, and Path D fires precisely on long-lived feature branches — the PRs most likely to exceed the cap. On this file's own worked example it returns 100 of `#4566`'s 116, so 14% of the branch never reaches the tally, silently. Page the commits as above and **assert the paged length equals `commits.totalCount`** before trusting any share, so a future cap change fails loudly instead of shifting a credit.

Three counting rules make the share mean what it says:

- **A commit counts once**, attributed to its human author. Do not tally `.commits[].authors[]`: a `Co-authored-by` trailer adds a second entry per commit, so the totals inflate past the commit count. `#4566` carries a `Co-authored-by: Cursor` trailer on 105 of its 116 commits.
- **Merge commits do not count.** Pressing the merge button on a sub-PR or syncing the base into the branch is not authorship, and on an umbrella PR those merges are exactly the merger's commits.
- **Apply the never-credited exclusions before comparing shares**, so an AI agent's co-authorship cannot dilute a human majority.

Then: when a single human other than the PR author holds a **decisive majority** of the non-merge commits, that human is `primaryAuthor`, and the PR author is **not** recorded as `viaAuthor` — a merge is not a carry-forward. Credit the author alone. Do not gate this on the PR author having written *exactly* zero commits: a maintainer who merges a feature branch commonly also lands a one-line test or lint fix on it, and a strict zero test lets that single commit hand them the whole branch's credit. On `#4566` the merging maintainer wrote 1 of the 109 non-merge commits, so the strict test would not have fired.

When no single human holds a decisive majority — a genuinely co-authored branch, say two contributors near 50/50 — do **not** fall back to the merger. Credit every human author whose share is material, primaries first in descending commit share: `*(@alice, @bob)*`. The verification pass below catches this case as a minority-credit row, so it always reaches a human; this rule says what that human should conclude.

An umbrella PR almost always ships alongside its sub-PRs, which also land on `main` through the same merge and describe the same work. When an umbrella PR and its sub-PRs both fall in the window, **coalesce them into one bullet** listing every number — `(#4566, #1701)` — rather than emitting the work twice.

> Real failure this rule exists to prevent: `#4566` "implementation of WMS" was credited to the maintainer who merged `feat/wms`. It carries **116** commits, 109 of them non-merge: **108 by `@mkadziolka`** and **1 by that maintainer** (`test(wms): use the shared LIKE escaper in listSearch tests`). `#1701` listed the same work a second time.
>
> The numbers matter as much as the conclusion. An earlier draft of this rule cited "192 commits, zero by the maintainer", which is what `gh pr view --json commits` reports: `100 + 92` **author entries** over a truncated 100-commit slice, double-counted because 105 of the commits carry an AI co-author, and showing zero maintainer commits only because the maintainer's one commit fell outside the truncation. Every figure in that sentence was wrong and the right conclusion survived by coincidence. Re-derive the tally with the paged command above rather than quoting these numbers.

### Path E — free-text attribution in the PR body

Contributors get handed off in prose that matches none of the `om-auto-review-pr` templates. Scan every PR body with these patterns, applied **case-insensitively** (no character-class alternations — the `i` flag carries all of it):

```
original author:? .*?@([A-Za-z0-9][A-Za-z0-9-]{0,38})
carries (the )?.*?\s?from #(\d+)
credits? (to|go(es)? to) @([A-Za-z0-9][A-Za-z0-9-]{0,38})
(takes?|took) over .*?@([A-Za-z0-9][A-Za-z0-9-]{0,38})
based on (the )?work (of|by) @([A-Za-z0-9][A-Za-z0-9-]{0,38})
```

**Every `.*` before a capture must be lazy (`.*?`).** A greedy quantifier backtracks from the end of the line and captures the *last* `@mention`, not the one the phrase introduces — so a hand-off note that also pings a reviewer credits the bystander:

```js
"Original author: Maciej Gren (@matgren) — assigning @reviewer for review/ownership"
// greedy .*  → "reviewer"   ← a published line crediting someone who wrote nothing
// lazy   .*? → "matgren"    ← correct
```

That failure is worse than the maintainer-credit bug this path exists to fix, because the credited handle is not even a plausible author. The credit pattern spells the verb `go(es)? to` rather than `goes? to` so the natural plural "credits **go** to @alice" matches alongside "credit **goes** to @alice" — `goes?` only covers `goe`/`goes` and silently misses the plural form.

The last capture group is the handle in every pattern **except `carries`, where it is a PR number** — that pattern ends on `#(\d+)` by design, and the next paragraph says how a number resolves. Do not "fix" it into a handle capture. Verify any edit to these patterns against the cases in the verification pass below before shipping it.

The `\s?` before `from` in the `carries` pattern makes the intervening phrase genuinely optional, so the bare `Carries from #4727` matches alongside `Carries the registry from #4727`. No observed body uses the bare form; it costs one character to not depend on that.

A captured handle becomes `primaryAuthor` with the merged PR author as `viaAuthor`. A captured PR number resolves its author via **get-pr** and additionally emits `(supersedes #N)` in the line text.

> Real failures: `#4276` ("Original author: Maciej Gren (@matgren) — assigning for review/ownership") and `#4761` ("Carries the registry from #4727 (original commit preserved)") were both credited to the maintainer.

### Mandatory verification pass — run before assembling the entry

This is not optional and not a spot check. For **every** bullet, compare the credited `primaryAuthor` against the PR's commit authorship and review each mismatch by hand:

| Signal | Verdict |
|--------|---------|
| Credited author wrote **0** commits **and** a `Credit:` / `Supersedes` template is present | ✅ correct — the original commits live on the closed PR; the template is authoritative over commit counts |
| Credited author wrote **0** commits **and** no template | ❌ **wrong** — apply Path D or E, or investigate before shipping |
| Credited author is a minority of commits, the rest by a maintainer | ✅ usually correct — normal review-fixup or rebase-and-fix carry |
| Credited author is a minority and the majority commit is titled "address review findings" or similar | ✅ correct — a review fix is not authorship |
| PR author differs from the dominant commit author on a >50-commit PR | ❌ investigate as an umbrella merge (Path D) |
| No single human holds a majority (two contributors near 50/50) | ❌ credit every material author (Path D), never the merger |
| The tallied commit count does not equal the PR's `commits.totalCount` | ❌ **stop** — the tally is truncated; page the commits and re-derive before trusting any share |
| A Path E body mentions more than one `@handle` | ❌ re-check the capture — a greedy quantifier would have taken the last one |

Two adversarial cases exercise the parts that real 0.6.7 data never reached, so run them explicitly rather than trusting a clean pass:

- **A hand-off body that also pings a reviewer** — `Original author: … (@contributor) — assigning @reviewer for review/ownership`. Both `#4276` and `#4761` happened to carry a single handle each, so the greedy-capture bug was invisible in the empirical run. Assert the capture is the contributor.
- **A run started from a clone that has not fetched since the release was cut** — the normal state for a fresh agent worktree. The window snippet runs *before* the new tag is cut, and `git rev-list "$LAST_TAG..origin/main"` is exclusive of `LAST_TAG`, so assert that `LAST_TAG` is the release **immediately preceding** the one being documented — `v0.6.6` when writing the `0.6.7` entry — and not an older tag. A stale clone leaves it one release further back and the window then spans two releases; demanding the tag of the release *being documented* instead yields a window holding only whatever landed after that tag was cut — empty at the moment of the cut, and never the release's own contents. Re-derive both counts at run time rather than quoting a figure from this file: `origin/main` advances after every tag, so any number written here is stale by the next release.
- **A tally taken on a >100-commit PR** — assert the paged commit count equals `commits.totalCount` before any Path D majority determination. This is the same move the `#3799` exclusion rule makes for the window: it converts a silent wrong answer into a loud stop.

Also run **Path C** properly: list closed-unmerged PRs for the window (**list-prs**, `closed:>=${SINCE_DATE} is:unmerged`) and scan their bodies **and comments** for `Closing in favor of #(\d+)`. Replacements that merged to `develop` after the release was cut from `main` are correctly absent from the entry — confirm rather than assume.

### Identities that are never credited

Exclude from commit tallies, from `primaryAuthor`/`viaAuthor`, and from the Contributors block: any handle matching `\[bot\]`, `dependabot`, `renovate`, `^app/`, `^web-flow$`, and the AI coding agents `claude`, `cursoragent`, `copilot`, `codex`, `devin`. When a PR's only credit resolves to a bot, render the bullet with **no** `*(@…)*` suffix rather than crediting the bot or the merger.

When carried-forward work originates from a bot (a Dependabot bump re-opened by a maintainer), the maintainer keeps the credit — there is no human original author to restore.

## Line format specifics

- This repo writes a closing-issue reference as a plain `(#N)` before the PR number — `Summary (#3860). (#4136) *(@author)*` — **not** the shared skill's `(fixes #N)`.
- Strip a leading `NNN - ` issue number and a `Fix GitHub issue #N: ` prefix out of the summary; carry the number into the `(#N)` slot instead.
- The conventional-commit prefix regex must accept digits so `i18n(customers):` is stripped: `^([a-z][a-z0-9_]*)(\([^)]*\))?!?:`.
- Coalesce PRs that differ only by a trailing `(develop)` / `(main)` marker — the same fix carried to both branches is one bullet.

## Highlights

The shared skill leaves `## Highlights` as a TODO marker. In this repo a maintainer usually asks for a draft instead — write it in the voice of the previous three entries (bolded theme phrases, concrete specifics, closing `Enjoy!`), lead with the release's single biggest change, and flag any claim you inferred rather than read directly off a PR so the maintainer can check it.

## Repo conventions the shared workflow already parameterizes

- The changelog PR targets whichever branch the release is cut from — `main` for a release entry, not the config's `baseBranch`. State the target explicitly in the report.
- Labels for the resulting PR: `documentation`, `skip-qa`, `review`, one `priority-*`, one `risk-*` (a docs-only changelog entry is `priority-medium` / `risk-low`).
- Never bump `package.json` — the version bump belongs to the release step, not the changelog entry.
