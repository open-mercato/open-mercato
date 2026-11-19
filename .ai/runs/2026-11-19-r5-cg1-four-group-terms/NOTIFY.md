# Notify — 2026-11-19-r5-cg1-four-group-terms

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-19T19:40:00Z — run started
- Brief: CG1 of the eComm Release 5 re-landing — four group terms (currency, approval policy, quote requests, PO number), resolveTerms base-currency fallback.
- External skill URLs: none

## 2026-11-19T19:40:00Z — decision: proceed without the relanding plan file
- `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` is absent from the primary checkout and from git history. The user instructed the run to continue autonomously; the card text in the brief plus the binding spec are used instead (PLAN.md difference #6).

## 2026-11-19T19:40:00Z — decision: base branch
- Branch cut from `refs/remotes/pr/9991` (`3261760b4d`); PR base `main` (config still says `develop`, which no longer exists).
