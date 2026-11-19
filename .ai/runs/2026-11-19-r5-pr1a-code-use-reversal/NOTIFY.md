# Notify — 2026-11-19 r5-pr1a-code-use-reversal

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-19T22:55:21Z — run started
- Brief: eComm Release 5 re-landing step PR1a — reversible code uses, retry-safe `codes/use`.
- External skill URLs: none

## 2026-11-19T22:55:21Z — decision: proceed without the binding plan file
- `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` is absent from the primary checkout and every git ref. The user instructed the run to continue autonomously; SPEC-055 (PR1a row, D-R5-PR*) and the card text in the brief are the binding sources. Logged in PLAN.md.

## 2026-11-19T22:55:21Z — decision: migration authored from the reference SQL
- No local database for `yarn db:generate`; SQL copied from reference `Migration20261026161603_promotions` with a fresh timestamp `20261119224920` (B3).
