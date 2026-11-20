# Execution plan — Workflows extraction and dependency-aware installation (adopted from PR #9678)

**Origin:** Reconstructed by `om-auto-continue-pr` on 2026-11-20.
**PR:** [#9678](https://github.com/open-mercato/open-mercato/pull/9678) · **Branch:** `spec/2026-11-15-modularize-core-business-modules` · **Base:** `main`
**Author:** @pkarw

## Goal

Specify the Workflows extraction, document cross-module mitigations for every extraction target, and define release gates for automatically installing and activating required providers.

## Scope

The proposed extraction spec, the evidence behind its dependency matrix, and acceptance criteria for the selector and installer.

## Non-goals

Runtime extraction, external installer edits, migrations, publication of packages and merging the PR.

## Evidence

| Conclusion | Source | Confidence |
|---|---|---|
| This is a design PR for thin-core extraction. | PR body, spec diff and maintainer decisions recorded in the spec | High |
| Workflows and installation closure belong in the same design. | Maintainer's 2026-11-20 task brief | High |
| ERP Map 0.9.0 is corroboration for branch findings. | Public release map and source inspection at PR head `64abf3138d` | High |

## Assumptions

The second specification is a section of the existing implementation spec. Confirm each remaining candidate edge through the Phase 0 proofs before cutting the extraction release. The ERP Map MCP requires authenticated access, so the public map and branch source supply the current evidence.

## Risks

Static analysis misses indirect activation and transaction dependencies. The spec requires exact provider identity, packed-install proofs and absence tests before extraction.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Define the thin-core extraction and compatibility strategy — 64abf3138d

### Phase 2: Workflows and dependency-aware installation

- [x] 2.1 Add the Workflows extraction, per-module dependency audit and selector/install gates — cb70fc32b8
