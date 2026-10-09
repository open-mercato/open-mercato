# Notify — 2026-10-09-standalone-app-default-ci

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-09T12:24:24Z — run started
- Brief: implement .ai/specs/2026-10-09-standalone-app-default-ci.md (default CI for scaffolded standalone apps)
- External skill URLs: none

## 2026-10-09T12:24:24Z — decisions (user)
- Q10: Phase 2 uses an opt-in app-owned discovery flag on `mercato test:integration`; defaults unchanged.
- Q11: upstream guard is a post-publish canary in snapshot.yml, labelled honestly.
- Q12: real-GitHub verification deferred to a manual follow-up; local Verdaccio + docker 7 GB verification instead.
- Spec status is "draft — awaiting core-team review"; user invoked implementation explicitly. The default-on scaffold change stays an explicit core-team ask in the PR body (create-app Ask First: scaffold modes).
