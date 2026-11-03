# Lessons

This catalog indexes 0 focused lessons without loading their full text. Route the task first, then read only records whose **modules**, standalone-harness **areas**, or **topics** match the work.

## How to use this catalog

1. Start with the exact module ID when one is named by the task.
2. Add every matching area from the standalone harness router: `architecture`, `module-data`, `umes`, `backend-ui`, `integration`, `ai-workflow`, `debugging`, `testing`, `framework-context`, or `spec-pr`.
3. Use topics to narrow cross-cutting concerns such as `data-scoping`, `optimistic-locking`, `query-index`, or `generated-files`.
4. Open only the linked lesson records that match; do not bulk-read `.ai/lessons/`.

Useful searches:

```bash
rg -n '\b<module-or-topic>\b' .ai/lessons.md
rg -l '"<area>"|"<module>"|"<topic>"' .ai/lessons/*.md
```

## Adding or updating a lesson

- Copy `.ai/lessons/_template.md` to one focused `.ai/lessons/<kebab-case-slug>.md`; update an existing record instead of duplicating it.
- Preserve the front matter keys `title`, `modules`, `areas`, and `topics`. Use `platform` only when no module or package owns the lesson, and put the primary area first.
- Add or update exactly one catalog row under its primary area below. Keep the title stable when code or specs cite it.
- Put hard boundaries in `AGENTS.md`; lessons explain recurring evidence and the durable rule.
- Run `node scripts/check-lessons.mjs` before committing.

## Catalog
