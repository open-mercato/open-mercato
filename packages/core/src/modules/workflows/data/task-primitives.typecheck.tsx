// Compile-time-only guard for the exported `TaskDeadline` contract and the
// exported config/persistence contracts that nest it. Never imported
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
import type {
  TaskDeadline as ValidatorsTaskDeadline,
  UserTaskConfig,
  UserTaskConfigSpec,
} from './validators'
import type { TaskDeadlinePersistence, TaskDeadlineSpecPersistence } from '../lib/task-inspector-config'
import { resolveTaskDeadlinePersistence } from '../lib/task-inspector-config'

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

// 7. The NESTED contracts are unchanged too: `UserTaskConfig['deadline']`,
//    `TaskDeadlinePersistence['deadline']` and the `resolveTaskDeadlinePersistence`
//    return type still carry exactly `TaskDeadline`.
const configDeadlineIsLegacy: MutuallyAssignable<UserTaskConfig['deadline'], TaskDeadline | undefined> = true
const persistenceDeadlineIsLegacy: MutuallyAssignable<
  TaskDeadlinePersistence['deadline'],
  TaskDeadline | undefined
> = true
const persistenceReturnIsLegacy: MutuallyAssignable<
  ReturnType<typeof resolveTaskDeadlinePersistence>,
  TaskDeadlinePersistence
> = true

// 8. Consumer code that narrows the nested deadline and reads it as before compiles.
function readConfigDuration(config: UserTaskConfig): string | null {
  if (!config.deadline) return null
  const deadline: TaskDeadline = config.deadline
  const duration: string = config.deadline.duration
  return deadline.duration === duration ? duration : null
}
function readPersistedDuration(config: UserTaskConfig, edited: string): string | null {
  const persisted = resolveTaskDeadlinePersistence(config, edited)
  if (!persisted.deadline) return persisted.slaDuration ?? null
  const deadline: TaskDeadline = persisted.deadline
  const duration: string = persisted.deadline.duration
  return deadline.duration === duration ? duration : null
}

// 9. The absolute form lives on the ADDITIVE extended types only, which accept
//    every legacy value.
const legacyConfigIsASpec: UserTaskConfigSpec = {} as UserTaskConfig
const absoluteConfigSpec: UserTaskConfigSpec = { deadline: { at: '{{context.dueDate}}' } }
// @ts-expect-error an `at`-only deadline is not part of the legacy UserTaskConfig
const absoluteConfigIsNotLegacy: UserTaskConfig = { deadline: { at: '{{context.dueDate}}' } }
const legacyPersistenceIsASpec: TaskDeadlineSpecPersistence = {} as TaskDeadlinePersistence

void configDeadlineIsLegacy
void persistenceDeadlineIsLegacy
void persistenceReturnIsLegacy
void readConfigDuration
void readPersistedDuration
void legacyConfigIsASpec
void absoluteConfigSpec
void absoluteConfigIsNotLegacy
void legacyPersistenceIsASpec
void durationIsString
void shapeIsUnchanged
void validatorsReExportIsUnchanged
void readDuration
void legacyIsASpec
void absoluteSpec
void absoluteIsNotLegacy
