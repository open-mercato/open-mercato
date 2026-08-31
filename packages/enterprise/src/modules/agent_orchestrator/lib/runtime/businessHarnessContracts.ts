/**
 * OM-facing names for the business harness wire protocol. The definitions come
 * from the harness package itself (`@open-mercato/business-harness/contracts`),
 * which is where the zod schemas that actually validate a run live. A
 * hand-mirrored copy on this side can drift from the schema that rejects it.
 */
import type {
  AgentExecutionBundle,
  AgentRunResult,
  ModelBinding,
  RunEvent,
  RunUsage,
} from '@open-mercato/business-harness/contracts'

export type BusinessHarnessModelDriver = ModelBinding['driver']
export type BusinessHarnessModelBinding = ModelBinding
export type BusinessHarnessExecutionBundle = AgentExecutionBundle
export type BusinessHarnessRunUsage = RunUsage
export type BusinessHarnessRunEvent = RunEvent
export type BusinessHarnessRunResult = AgentRunResult
