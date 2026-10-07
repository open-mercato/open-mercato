# Group Notification Delivery settings by source module

Source doc: .ai/specs/2026-04-28-push-notifications-and-devices.md
Issue: #6746

## Goal

Let operators scan the admin Notification Delivery matrix by the source category already supplied by the notification catalogue.

## Scope

Use stable category keys, localized category labels, a translated fallback for missing categories, and deterministic group ordering in the existing admin table. Preserve catalogue order within each group and channel order. Keep the existing guarded writes, per-cell saving indicator, accessible switch names, optimistic locking, and conflict refresh.

Non-goals: changing delivery semantics, API/schema/type IDs, dependencies, module discovery, the self-service preferences screen, or the admin-on-behalf preferences screen.

## Implementation Plan

### Phase 1: Grouped matrix and regression coverage

1.1 Add category fields and accessible grouped table bodies, localized fallback copy, and component regressions proving grouping and unchanged save paths.

1.2 Extend the native notification integration case to verify multiple category groups and a persisted channel toggle; document this focused post-spec UI delta in the existing spec.

### Phase 2: Validation

2.1 Run the ordered configured validation gate with an explicitly chosen runner, review the final diff, and record environment-specific remediation accurately.

After the plan is implemented, run the installed PR review and real-browser QA workflows, publish their evidence, release claims, and hand off pending remote CI. Required CI and independent QA approval remain merge gates.

## Risks

- Grouping by a translated label could merge unrelated categories. Key groups by category and test equal labels on different keys.
- Nullable/custom catalogue entries could disappear or collide with a real category. Keep a separate null-key fallback group and test collisions.
- Moving rows could disturb guarded mutation or lock handling. Preserve their callbacks and test channel, Required, saving, and conflict paths through grouped rows.
- Local Homebrew Node's dynamic libuv dependency is outside the create-app test sandbox. If reproduced, run that package alone with the self-contained bundled Node, without changing sandbox policy. Do not run broad monorepo Jest with the bundled Node because unrelated V8 GC crashes have already been reproduced.
- Installed structured review schema/renderer is unavailable. Record code findings separately and report formal review INCOMPLETE; local validation does not substitute for required remote CI.

## Progress

PR: #6825

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Grouped matrix and regression coverage

- [x] 1.1 Add grouped table bodies, fallback translations, and component regressions. — 3caf855c1b
- [x] 1.2 Extend integration coverage and the existing spec. — 8e6bda63ef

### Phase 2: Validation

- [x] 2.1 Complete the configured validation gate and final diff review. — validated 4fd6cd35ff

## Validation evidence

Runner: local (neither probed compose configuration had a running app). Package build, generation, package build, translation sync, translation usage, type checking and app build completed in order. The first translation-sync attempt caught unsorted new keys; native formatting fixed only those five locale entries and the gate restarted.

The ordinary full unit run passed 46 of 47 package tasks; create-app alone hit the known Homebrew Node libuv sandbox restriction (812 passed, 80 failed, 5 skipped). Its sequential rerun using the self-contained bundled Node passed 892 tests with 5 existing skips; no sandbox policy or source bypass was used. Core passed 2,009 suites / 18,202 assertions, including all 7 component cases for this change.

Additional checks: test:scripts 997 passed / 1 existing skip; scoped design-system lint passed; template parity passed; client-boundary audit completed with existing advisory output. The final production diff review found no actionable correctness or compatibility issue. Native integration, browser evidence and remote CI are reported on PR #6825 separately; this plan does not assert their completion.
