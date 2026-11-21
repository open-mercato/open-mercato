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
// What it protects (#7181): an absolute deadline is the ADDITIVE sibling
// `userTaskConfig.deadlineAt`, never a form of `deadline`. `TaskDeadline` —
// re-exported from `data/validators` — must keep `duration` as a required
// `string`, so consumer code reading `deadline.duration` as a `string` keeps
// compiling (BACKWARD_COMPATIBILITY.md). The same holds for every schema RESULT
// that nests it: a parsed step or definition, the definition API inputs, and the
// definition response schemas the routes document.
import type { z } from 'zod'
import type { CodeStepDefinition } from '@open-mercato/shared/modules/workflows'
import type { TaskDeadline } from './task-primitives'
import type {
  CreateWorkflowDefinitionApiInput,
  CreateWorkflowDefinitionInput,
  TaskDeadline as ValidatorsTaskDeadline,
  UpdateWorkflowDefinitionApiInput,
  UpdateWorkflowDefinitionInput,
  UserTaskConfig,
} from './validators'
import { workflowDefinitionDataSchema, workflowStepSchema } from './validators'
import type {
  workflowDefinitionDetailResponseSchema,
  workflowDefinitionListResponseSchema,
  workflowDefinitionMutationResponseSchema,
  workflowDefinitionResetResponseSchema,
  workflowDefinitionResponseSchema,
} from '../api/openapi'
import type { TaskDeadlinePersistence } from '../lib/task-inspector-config'
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

// 5. An absolute `at` was never a `TaskDeadline` and still is not one.
// @ts-expect-error an `at`-only deadline has no `duration`, so it is not a TaskDeadline
const absoluteIsNotADeadline: TaskDeadline = { at: '{{context.dueDate}}' }

// 6. The absolute form is the optional sibling `deadlineAt`, a plain string.
const deadlineAtIsOptionalString: MutuallyAssignable<UserTaskConfig['deadlineAt'], string | undefined> = true
const absoluteConfig: UserTaskConfig = { deadlineAt: '{{context.dueDate}}' }

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

// 9. The enclosing schema RESULTS are unchanged: a consumer parsing with them
//    narrows the deadline and reads `duration` as a `string`, and may assign the
//    parsed config to `UserTaskConfig`.
type StepDeadline<Step extends { userTaskConfig?: { deadline?: unknown } }> = NonNullable<
  Step['userTaskConfig']
>['deadline']
type DefinitionDeadline<Definition extends { steps: Array<{ userTaskConfig?: { deadline?: unknown } }> }> =
  StepDeadline<Definition['steps'][number]>

function readParsedStepDuration(raw: unknown): string | null {
  const step = workflowStepSchema.parse(raw)
  if (!step.userTaskConfig?.deadline) return null
  const config: UserTaskConfig = step.userTaskConfig
  const duration: string = step.userTaskConfig.deadline.duration
  return config.deadline?.duration === duration ? duration : null
}
function readParsedDefinitionDuration(raw: unknown): string | null {
  const definition = workflowDefinitionDataSchema.parse(raw)
  const config: UserTaskConfig | undefined = definition.steps[0]?.userTaskConfig
  const duration: string | undefined = definition.steps[0]?.userTaskConfig?.deadline?.duration
  return config?.deadline?.duration === duration ? (duration ?? null) : null
}

type Legacy = TaskDeadline | undefined
const createInputIsLegacy: MutuallyAssignable<DefinitionDeadline<CreateWorkflowDefinitionInput['definition']>, Legacy> = true
const updateInputIsLegacy: MutuallyAssignable<
  DefinitionDeadline<NonNullable<UpdateWorkflowDefinitionInput['definition']>>,
  Legacy
> = true
const createApiInputIsLegacy: MutuallyAssignable<
  DefinitionDeadline<CreateWorkflowDefinitionApiInput['definition']>,
  Legacy
> = true
const updateApiInputIsLegacy: MutuallyAssignable<
  DefinitionDeadline<NonNullable<UpdateWorkflowDefinitionApiInput['definition']>>,
  Legacy
> = true

type ResponseRow = z.infer<typeof workflowDefinitionResponseSchema>
const responseIsLegacy: MutuallyAssignable<DefinitionDeadline<ResponseRow['definition']>, Legacy> = true
const listResponseIsLegacy: MutuallyAssignable<
  z.infer<typeof workflowDefinitionListResponseSchema>['data'][number],
  ResponseRow
> = true
const detailResponseIsLegacy: MutuallyAssignable<
  z.infer<typeof workflowDefinitionDetailResponseSchema>['data'],
  ResponseRow
> = true
const mutationResponseIsLegacy: MutuallyAssignable<
  z.infer<typeof workflowDefinitionMutationResponseSchema>['data'],
  ResponseRow
> = true
const resetResponseIsLegacy: MutuallyAssignable<
  z.infer<typeof workflowDefinitionResetResponseSchema>['data'],
  ResponseRow | null
> = true

// 10. A code-defined USER_TASK declares the absolute form as the sibling key,
//    and its `deadline` stays duration-only.
const codeStepCarriesAt: CodeStepDefinition = {
  stepId: 'review',
  stepName: 'Review',
  stepType: 'USER_TASK',
  userTaskConfig: { deadlineAt: '{{context.dueDate}}' },
}
const codeStepDeadlineIsLegacy: MutuallyAssignable<
  NonNullable<CodeStepDefinition['userTaskConfig']>['deadline'],
  TaskDeadline | undefined
> = true

void codeStepCarriesAt
void readParsedStepDuration
void readParsedDefinitionDuration
void createInputIsLegacy
void updateInputIsLegacy
void createApiInputIsLegacy
void updateApiInputIsLegacy
void responseIsLegacy
void listResponseIsLegacy
void detailResponseIsLegacy
void mutationResponseIsLegacy
void resetResponseIsLegacy
void configDeadlineIsLegacy
void persistenceDeadlineIsLegacy
void persistenceReturnIsLegacy
void readConfigDuration
void readPersistedDuration
void durationIsString
void shapeIsUnchanged
void validatorsReExportIsUnchanged
void readDuration
void absoluteIsNotADeadline
void deadlineAtIsOptionalString
void absoluteConfig
void codeStepDeadlineIsLegacy
