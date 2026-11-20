// Compile-time-only drift guard between the engine's zod schemas and the
// code-definition types `defineWorkflow` accepts (#7183). Never imported at runtime:
// `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch a regression
// here, because this repo's Jest transform runs with `isolatedModules: true`.
//
// `@open-mercato/shared` cannot import these schemas, so it mirrors them by hand;
// this file is where the two meet. When it fails, the engine accepts something a
// code-defined workflow cannot express: add the key or member to
// `packages/shared/src/modules/workflows/types.ts` (optional keys and union members
// only — never narrow an existing one), and to the key list in
// `lib/__tests__/code-definition-types-parity.test.ts`.
import type { z } from 'zod'
import type { CodeStepDefinition, WorkflowStepType as CodeWorkflowStepType } from '@open-mercato/shared/modules/workflows'
import type { userTaskConfigSchema, workflowStepTypeSchema } from './validators'

type CodeUserTaskConfig = NonNullable<CodeStepDefinition['userTaskConfig']>
type EngineUserTaskConfigInput = z.input<typeof userTaskConfigSchema>
type EngineWorkflowStepType = z.infer<typeof workflowStepTypeSchema>

// 1. Every step type the engine validates is a code step type, and vice versa.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const stepTypesMatch: MutuallyAssignable<EngineWorkflowStepType, CodeWorkflowStepType> = true

// 2. No `userTaskConfig` key the engine accepts is missing from the code type.
type MissingUserTaskKeys = Exclude<keyof EngineUserTaskConfigInput, keyof CodeUserTaskConfig>
const noMissingUserTaskKeys: [MissingUserTaskKeys] extends [never] ? true : false = true

// 3. No code key is unknown to the engine (zod would strip it on save).
type UnknownUserTaskKeys = Exclude<keyof CodeUserTaskConfig, keyof EngineUserTaskConfigInput>
const noUnknownUserTaskKeys: [UnknownUserTaskKeys] extends [never] ? true : false = true

// 4. Every config the engine accepts is assignable to the code type, nested values
//    included (e.g. a new member of `onBreach.action` or a new key on `deadline`).
const engineConfigFitsCodeType: [EngineUserTaskConfigInput] extends [CodeUserTaskConfig] ? true : false = true

void stepTypesMatch
void noMissingUserTaskKeys
void noUnknownUserTaskKeys
void engineConfigFitsCodeType
