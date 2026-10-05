# Notify — 2026-10-05-release-3-storefront-read-side

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-05T10:47:00Z — run started
- Brief: storefront read side release — roadmap Phase 1 + visibility Phase 2 (SPEC-029 P1–3, Storefront Public API P1–3, Omnibus MVP, prerequisites), continuing fork PR #12.
- External skill URLs: none
- Decisions: owner override — reuse PR #12 and its branch instead of feat/release-3-storefront-read-side; Phase 0 already done (8040682f1a). Owner added Omnibus to this PR (D11); authoritative spec = 2026-06-30-omnibus-price-tracking.md (it supersedes SPEC-033), MVP Phases 1–3 only.
- Repo guard: all pushes to remote `fork`; all gh commands with --repo adeptofvoltron/open-mercato; upstream read-only.
