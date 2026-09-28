# Notify — 2026-09-28-configurable-calendar-event-types

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-28T17:26:05Z — run started

- Brief: implement both calendar event-type specs from #6687, including a mirrored example that hides, patches, adds, and custom-renders types.
- External skill URLs: none.
- Decision: keep #6687 design-only; create a separate implementation PR for #6684 from `develop` and reference the unmerged source specs by PR/branch.
- QA mapping: use installed `om-auto-qa-pr` for the requested `om-auto-verify-qa-pr` outcome because no skill with the latter exact name is installed.
