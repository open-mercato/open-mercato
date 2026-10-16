// Compile-time-only guard for the exported `TaskDeadline` contract. Never imported
// at runtime: `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch a
// regression here, because this repo's Jest transform runs with
// `isolatedModules: true` and therefore skips type diagnostics.
//
// It sits outside `__tests__` because `packages/core/tsconfig.json` excludes that
// directory from `tsc --noEmit`, and it is a `.tsx` for the same mutation-gate
// reason as `packages/shared/src/lib/i18n/config.typecheck.tsx`.
//
// What it protects (#7181): the absolute `deadline.at` form is the ADDITIVE
// `TaskDeadlineSpec`. `TaskDeadline` — re-exported from `data/validators` — must
// keep `duration` as a required `string`, so consumer code reading
// `deadline.duration` as a `string` keeps compiling (BACKWARD_COMPATIBILITY.md).
import type { TaskDeadline, TaskDeadlineSpec } from './task-primitives'
import type { TaskDeadline as ValidatorsTaskDeadline } from './validators'

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// 1. `TaskDeadline['duration']` is still exactly `string` — not optional, not widened.
const durationIsString: MutuallyAssignable<TaskDeadline['duration'], string> = true

// 2. The whole legacy shape is unchanged: `{ duration: string }`, nothing more.
const shapeIsUnchanged: MutuallyAssignable<TaskDeadline, { duration: string }> = true

// 3. The re-export from `data/validators` is the same contract.
const validatorsReExportIsUnchanged: MutuallyAssignable<ValidatorsTaskDeadline, { duration: string }> = true

// 4. Consumer code that treats `deadline.duration` as a `string` compiles.
function readDuration(deadline: TaskDeadline): string {
  return deadline.duration
}

// 5. A legacy deadline is still a valid spec, so the spec is a strict superset.
const legacyIsASpec: TaskDeadlineSpec = { duration: 'P3D' } satisfies TaskDeadline

// 6. An absolute `at` is a spec only — it is NOT a `TaskDeadline`.
const absoluteSpec: TaskDeadlineSpec = { at: '{{context.dueDate}}' }
// @ts-expect-error an `at`-only deadline has no `duration`, so it is not a TaskDeadline
const absoluteIsNotLegacy: TaskDeadline = { at: '{{context.dueDate}}' }

void durationIsString
void shapeIsUnchanged
void validatorsReExportIsUnchanged
void readDuration
void legacyIsASpec
void absoluteSpec
void absoluteIsNotLegacy
