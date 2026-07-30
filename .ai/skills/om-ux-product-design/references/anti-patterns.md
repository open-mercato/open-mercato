# Anti-Pattern Blocklist

Block these outright — in designs you produce and in screens you audit. Each row states how it is detected in a mockup audit: **mechanical** checks run deterministically in `packages/core/src/modules/design_system/mockups/heuristics.ts`; **judgment** checks are applied by `om-ux-heuristics` with the same finding vocabulary; **process** rules bind the skill itself.

| Anti-pattern | Why it is blocked | Detection |
|---|---|---|
| Placeholder as the only label | The label disappears the moment the user types; recall over recognition | Mechanical — `om-placeholder-only-label` (placeholder-ish prop key with no label/title sibling) |
| Vague buttons (OK/Next/Send) when the action can be named | The button is the contract; a bare verb names no contract | Mechanical — `om-vague-action-label` (bare-verb string prop on an action entry) |
| Error without how-to-fix | An error message that only announces failure strands the user | Judgment — check every error/validation copy names the fix |
| Wiping data after an error | Punishes the user for the system's failure | Judgment — flow-level; assert data preservation in notes/acceptance criteria |
| Disabled button without explaining the missing condition | The user cannot infer what to change | Judgment — disabled states must state their condition |
| Unlabeled icons with non-universal meaning | Icon comprehension is context-dependent | Judgment — icon-only actions need accessible names and usually visible labels |
| Auto-executing important actions silently | Removes consent and awareness | Judgment — significant actions are user-initiated or clearly announced |
| Hiding price, fees, or consequences | Progressive disclosure never hides costs | Judgment — cost/consequence info present before commitment |
| Forced registration without justification | Demands data before demonstrating value | Judgment — flow-level |
| Status by color alone | Excludes color-blind users; violates WCAG 1.4.1 | Judgment in mockups (variant/props inspection); DS status components pair color with text/icon |
| Happy-path-only design | Most user pain lives off the happy path | Judgment — audit against the full state matrix |
| Copying pretty screens without knowing their results | Aesthetics are not evidence | Process — visual inspiration ranks last in the hierarchy |
| Fake personas or quotes as research | Fabricated evidence poisons every decision downstream | Process — hard rule; [ASSUMPTION] tag exists precisely so this is never needed |

Mechanical coverage is intentionally conservative: a check is only implemented mechanically when it is decidable from the document alone with no false-positive judgment calls. Everything else stays a judgment check so the finding can cite the actual block and context.
