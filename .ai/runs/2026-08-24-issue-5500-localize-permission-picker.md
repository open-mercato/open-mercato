# Execution plan — localize the complete permission-editing experience (adopted from PR #5538)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #5538 carried no execution plan.
**PR:** #5538 · **Branch:** `fix/issue-5500-localize-permission-picker` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Keep permission editing localized in the Polish backoffice while preserving readable fallbacks and preventing the generated English ACL catalog from drifting from feature declarations.

## Scope

The auth module's user and role edit metadata, ACL picker labels, ACL catalog tests, and the review feedback on PR #5538.

## Non-goals

- Changing ACL identifiers, authorization behavior, API response contracts, or database state.
- Translating the new ACL catalog into additional languages beyond the complete Polish catalog already delivered by this PR.
- Broadly changing repository-wide i18n tooling for intentionally untranslated placeholder values.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The permission picker and surrounding edit-page chrome must remain localized in Polish. | Issue #5500 and PR #5538 Goal | high |
| The role edit metadata is still English and is inside the PR's stated user-and-role scope. | Requested-change review by @pkarw and the role edit metadata file | high |
| The English ACL catalog needs a drift guard and unknown features need a fallback regression test. | Requested-change review by @pkarw and the current diff | high |
| Nested wildcard identifiers should remain readable and the dead transition utility should be removed. | Review nits by @pkarw and the current component implementation | high |

## Assumptions

- The explicit instruction to address the requested changes, fix the issue, and push confirms autonomous continuation of this reconstructed plan.
- English placeholder values in German, Spanish, and Korean remain intentional because synchronized locale key parity is required and those locales already fell back to the same English feature titles before this change.

## Risks

- Catalog discovery in the drift test must cover every repository ACL declaration without coupling production code to test-only filesystem traversal.
- Metadata key-resolution tests must account for shared `common.*` keys that are merged at runtime rather than incorrectly expecting them in the auth dictionary.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Localize the user permission editor, ACL catalog, diagnostics, helper copy, and Polish translations — f46407a94

### Phase 2: Address requested changes

- [ ] 2.1 Localize role edit metadata and verify shipped metadata keys resolve
- [ ] 2.2 Add ACL catalog drift and fallback regressions, restore readable wildcard labels, and remove the dead transition utility

### Phase 3: Validate and publish

- [ ] 3.1 Run the configured validation gate and authoritative review
- [ ] 3.2 Update the PR documentation and labels, push the completed branch, and release the claim
