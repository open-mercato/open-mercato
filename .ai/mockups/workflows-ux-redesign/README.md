# Workflows UX Redesign — HTML mockups

Static mockups of the surfaces delivered by the workflow UX refactor, per
[`.ai/specs/2026-07-26-workflows-ux-redesign.md`](../../specs/2026-07-26-workflows-ux-redesign.md)
(companion: the 156-story catalog next to it) and the #4251 backlog.

**Open `index.html` in a browser.** Works over `file://` — no server needed.
Use the sun button (top right) to check both themes; both are in scope.

Each screen carries numbered lime callout dots; the list beneath maps every
change to its spec section and backlog issue. The mockups look like production
(same DS tokens, AppShell/inspector anatomy) and behave like a sketch — nothing
saves, computes, or validates.

## Screens

| # | Screen | Shows | Spec / issues |
|---|--------|-------|---------------|
| 1 | Studio canvas | Auto-layout LR + persisted arrangement, edge condition/activity chips, error routes, agent outcome handles, node error badges, Problems panel | §4, §7.2 · #4248 #4244 #4233 #4232 |
| 2 | Activity inspector | Registry-generated UPDATE_ENTITY form, mapping pills, ƒx escape hatch, variable picker with sample values + maybe-markers, outputs contract, per-node Test step | §3, §5, §8.2 · #4245 #4235 #4230 |
| 3 | User Task inspector | Instructions with context pills, entity binding, Role/User/Dynamic/Rule assignment, deadline duration picker + breach route, form builder with live preview, decision-buttons-as-branches | §6.1 · #4239 #4240 #4241 #4242 #4229 |
| 4 | Invoke Agent inspector | Typed I/O against OUTCOME schema, disposition policy, Review (who/when), labeled disposition routes, guardrail-block route | §7 |
| 5 | Test & dry-run | Fixtures, schema-generated start form, mocked effectors, execution overlay, “Would do” report, honest SEND_EMAIL stub | §8.1–§8.3 · #4249 |
| 6 | Run timeline | Three-altitude run views, clock-scaled Gantt with collapsed waits, tool-call sub-bars, retry segments, re-run from step, live SSE | §8.3–§8.4 |
| 7 | Work Inbox | Unified tasks + agent reviews queue, entity context, editable proposal payload, decision facts, confidence vs threshold, complete-&-next | §2.3, §6.2–§6.4 · #4246 #4238 #4247 |
| 8 | Code view + Copilot | Canvas ⇄ code (form editor retired), shared validation with squiggles, AI checkpoint diffs | §2.2, §9 · #4237 |

## Token convention

`tokens.css` is a copy of the DS custom properties from
`apps/mercato/src/app/globals.css` (same convention as
`.ai/mockups/time-tracking/`). If the design system changes, re-copy or re-run
the sync script referenced in that file's header. `mockup.css` uses only those
tokens — no raw colors.
