# Execution plan — passkey enrollment review remediation (adopted from PR #6824)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #6824 has no tracking plan.
**PR:** #6824 · **Branch:** `codex/fix-6800-passkey-attestation` · **Base:** `main`
**Author:** @haxiorz

## Goal

Finish the independently actionable review remediation while preserving verified passkey enrollment, the current main behavior, and the named human security-exception merge gate.

## Scope

Merge the current PR base, resolve conflicts, validate the resulting security paths, publish the correction, and request re-review.

## Non-goals

No merge, compatibility bridge restoring vulnerable enrollment, human waiver, QA approval, release-policy change, or unrelated refactor.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Verified WebAuthn enrollment and localized rejection are implemented | PR description, security spec, head `5862cad387674e3006e87e89bcc1d4e99bedce7a` | High |
| Current base conflicts require resolution | Review `5564811872`; current PR base is `main` | High |
| A named human must acknowledge the Emergency Security Exception | Same review, `BACKWARD_COMPATIBILITY.md`, security spec; QA comment `6238527028` explicitly preserves the gate | High |

## Assumptions

The PR metadata's current base `main` supersedes historical `develop` references. Existing QA evidence remains historical evidence for its stated head; the agent will not infer a human waiver from it. The unchecked CLA declaration remains the author's personal attestation.

## Risks

Conflicts may combine main's error-reporting requirements with the provider's localized validation boundary. Both must survive. Removed STABLE payload acceptance remains gated by explicit named human approval.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Require verified registration, preserve signed login, cover legacy rejection and document migration — 5862cad387674e3006e87e89bcc1d4e99bedce7a

### Phase 2: Resolve and publish review remediation

- [ ] 2.1 Merge current main and preserve both passkey verification and main changes
- [ ] 2.2 Run focused validation and review the resulting head using CI-first policy
- [ ] 2.3 Publish evidence and request re-review while preserving changes-requested

### Phase 3: Human merge gates

- [ ] 3.1 Obtain named human maintainer acknowledgment of the Emergency Security Exception
- [ ] 3.2 Author confirms the outstanding CLA declaration if still required
