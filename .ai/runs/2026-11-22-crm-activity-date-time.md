# CRM activity creation from one date and time

Source doc: .ai/specs/2026-11-22-crm-activity-date-time.md
Design: #10406
Issue: #5108

Let people log a past interaction or plan a future interaction from the same activity composer on person, company, and deal detail pages.

Use the shared date picker, guarded interactions POST, and existing refresh callbacks. Keep full scheduling available in Planned activities on an empty record. The timestamp comparison needs a non-UTC test and a fixed submit clock at the boundary.

## Progress

PR: #10407

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Unified composer

- [x] 1.1 Characterize the existing save payload and refresh. — f2fc7d2e89
- [ ] 1.2 Create logged and planned activities from one date and time.
- [ ] 1.3 Verify the flow on person, company, and deal detail pages.
- [ ] 1.4 Archive the creation requirement.
