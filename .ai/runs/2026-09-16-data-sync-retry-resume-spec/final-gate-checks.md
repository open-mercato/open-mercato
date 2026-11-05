# Final gate — all Steps complete

**Ran at:** 2026-09-16T12:44:00Z
**Steps covered:** 1.1 … 3.1, all nine. Subsumes the checkpoint that would otherwise have fired at the
close of Phases 2 and 3.
**SHA range:** `e42c7b411a` … `a00d97f2af`
**Gate applied:** the **docs-only minimum gate** from `references/final-gate.md` — "whatever configured
command lints docs or markdown, if one exists; a manual re-read of the diff. The integration suite and
the style compliance pass are skipped; record that explicitly."

This run qualifies: every changed path is under `.ai/`, and the only non-markdown artifact is the
static prototype, which is not part of any application build.

## Why the full `validation.commands` list was not run

`validation.commands` is `build:packages`, `generate`, `build:packages`, `i18n:check-sync`,
`i18n:check-usage`, `typecheck`, `test`, `build:app`. Every one of them takes its input from
`packages/` or `apps/`, and this branch changes no file in either — verified mechanically as check A
below, not assumed. Running them would compile the same tree twice and prove nothing about the diff.
This is the documented docs-only path, not a shortcut taken on external advice.

## Checks

| # | Check | Result | Notes |
|---|---|---|---|
| A | Every changed path is under `.ai/` | ✅ pass | `git diff --name-only origin/develop...HEAD` filtered for anything outside `.ai/` returns nothing. The "no implementation" non-goal holds, and this is what qualifies the run for the docs-only gate |
| B | Prototype `tokens.css` still matches the generator | ✅ pass | `sync-tokens.mjs --check` — "tokens.css is current". The redraw did not hand-edit generated tokens |
| C | All ten required spec sections present | ✅ pass | Per `.ai/specs/AGENTS.md` § Spec Content Checklist |
| D | No unresolved gate markers left in the spec | ✅ pass | No `Open Question`, `TODO`, `TBD`, or "to be written" remains; the skeleton's placeholder paragraph is gone |
| E | No stale reference to the deleted server-side-gate phase | ✅ pass | The only two matches are the deliberate withdrawal statements in § Decisions taken, which exist to record that the framing was retracted |
| F | Decision numbering contiguous in § Proposed Solution | ✅ pass | Items 1–7, no gaps, each matching a redrawn prototype screen |
| G | Prototype README documents every decision | ✅ pass | D0–D7 tabulated, each naming the screens redrawn for it |
| H | Manual re-read of the diff | ✅ pass | 15 files, +4377/−1. Re-read in full; see § Manual review notes |

## Browser verification of the redrawn prototype

Served from `python3 -m http.server 8899 --bind 127.0.0.1`, rendered in Chromium at 1500×1000 in both
themes. The server was terminated immediately afterwards.

| Assertion | Expected | Actual |
|---|---|---|
| Console errors | only the `favicon.ico` 404 | ✅ only that |
| Screens / notes | 13 / 48 | ✅ 13 / 48 |
| Horizontal overflow in any shell | 0 | ✅ 0 |
| Dangling `data-goto` targets | none | ✅ none |
| Dangling hash links | none | ✅ none |
| Missing icon symbols | none | ✅ none |
| Empty popovers left by the redraw | 0 | ✅ 0 |
| **D1** — screen 9 primary action label | `Resume` | ✅ `Resume` |
| **D2** — screens still offering "Run again" | s5 and s11 only (both `completed`) | ✅ s5=1, s11=1 |
| **D3** — screen 8 overflow buttons | 0 | ✅ 0 |
| **D4** — screen 12 full-sync switch | `aria-checked="false"` | ✅ `false` |
| **D0** — screen 13 alerts | 2, the third removed | ✅ 2 |

Artifacts in `final-gate-artifacts/`:

- `screenshot-s1-action-matrix.png` — the decision matrix agreeing with D0–D5
- `screenshot-s3-failed-row-menu.png` — the failed-run row menu without "Run again" (D2)
- `screenshot-s13-rejections.png` — the two real rejections, the withdrawn third gone (D0)
- `screenshot-s9-cancelled-resume-dark.png` — `Resume` on a cancelled run, dark theme (D1)

## Skipped, with reasons

| Item | Why |
|---|---|
| Full `validation.commands` list | No input to any of them changed — see above. Verified mechanically by check A |
| Full integration suite via `om-integration-tests` | Docs-only run, explicitly skipped by `references/final-gate.md`. The spec *specifies* three new integration cases (`TC-DS-012`–`014`); they ship with the implementation PR |
| Design-system / style compliance pass | Docs-only run, explicitly skipped. The static prototype uses only DS tokens from the generated `tokens.css`, re-verified by check B |
| `yarn i18n:check-sync` / `check-usage` | No locale file and no `useT()` call site changed. The spec specifies the i18n work; it does not perform it |

## Manual review notes

Read the full diff once more before closing the gate. Three things worth a reviewer's attention, all
already reflected in the documents:

1. **The strongest finding of the run inverts the premise it started from.** The work began from the
   claim that `api/runs/[id]/retry.ts` has a server-side hole because it never consults
   `supportsStartControl`. `BACKWARD_COMPATIBILITY.md` § Data Sync Start Control Applicability commits
   the opposite in writing — the declaration "governs what the dashboard **offers**, never what the run
   API **accepts**", and that separation "MUST hold for any future change here". Closing the supposed
   hole would have broken a recorded contract commitment. The claim is withdrawn in the spec, in both
   prototype documents, and on the two screens that asserted it.
2. **The feature ends up with no API change at all**, which is a consequence of (1) rather than a
   coincidence. Every value the new UI needs — `cursor`, `initialCursor`, `batchesCompleted` — already
   ships on both the list and detail payloads.
3. **Seven prototype choices were reversed, not five.** The two extra (no "resumed from" column; nothing
   rendered in the resume-point slot for a non-retryable state) surfaced while reconciling the two
   documents — the second was an outright contradiction between the prototype's screen 10 and the
   spec's own UI/UX table, which says a `none` resume point renders nothing.

## Outcome

✅ **Final gate passes.** All nine Steps are `done`, the spec is complete and internally consistent,
the prototype agrees with it on every point, and nothing outside `.ai/` was touched.
