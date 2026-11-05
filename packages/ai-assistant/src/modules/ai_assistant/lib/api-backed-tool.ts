// Phase 2 of spec 2026-04-27-ai-tools-api-backed-dry-refactor.md.
//
// Sugar over `defineAiTool` that wires the in-process API operation runner so
// typed AI tools can reuse documented API route logic without HTTP, fetch, or
// a second RBAC pass. The synthesized handler delegates to
// `createAiApiOperationRunner(ctx).run(toOperation(input, ctx))` and pipes the
// response through `mapResponse(...)`. All other tool-runtime concerns
// (registry indexing, schema serialization, mutation policy, pending-action
// flow, `loadBeforeRecord(s)`, telemetry) remain owned by `defineAiTool`.
import type { z } from 'zod'
import { defineAiTool } from './ai-tool-definition'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiApiOperationResponse,
  type AiToolExecutionContext,
} from './ai-api-operation-runner'
import type { AiToolDefinition, McpToolContext } from './types'

export type ApiBackedAiToolConfig<TInput, TApi, TOutput> = {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures: string[]
  isMutation?: boolean
  toOperation: (
    input: TInput,
    ctx: AiToolExecutionContext,
  ) => AiApiOperationRequest | Promise<AiApiOperationRequest>
  mapResponse: (
    response: AiApiOperationResponse<TApi>,
    input: TInput,
    ctx: AiToolExecutionContext,
  ) => TOutput | Promise<TOutput>
  loadBeforeRecord?: AiToolDefinition<TInput, TOutput>['loadBeforeRecord']
  loadBeforeRecords?: AiToolDefinition<TInput, TOutput>['loadBeforeRecords']
}

export function defineApiBackedAiTool<TInput, TApi, TOutput>(
  config: ApiBackedAiToolConfig<TInput, TApi, TOutput>,
): AiToolDefinition<TInput, TOutput> {
  const {
    name,
    displayName,
    description,
    inputSchema,
    requiredFeatures,
    isMutation,
    toOperation,
    mapResponse,
    loadBeforeRecord,
    loadBeforeRecords,
  } = config

  let definition: AiToolDefinition<TInput, TOutput>

  const handler = async (input: TInput, context: McpToolContext): Promise<TOutput> => {
    const toolCtx: AiToolExecutionContext = {
      ...context,
      tool: definition as unknown as AiToolDefinition,
    }
    const operation = await toOperation(input, toolCtx)
    const runner = createAiApiOperationRunner(toolCtx)
    const response = await runner.run<TApi>(operation)
    if (!response.success) {
      throw new Error(response.error ?? `API operation failed for tool "${name}"`)
    }
    return await mapResponse(response, input, toolCtx)
  }

  definition = defineAiTool<TInput, TOutput>({
    name,
    description,
    inputSchema,
    requiredFeatures,
    handler,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(isMutation !== undefined ? { isMutation } : {}),
    ...(loadBeforeRecord !== undefined ? { loadBeforeRecord } : {}),
    ...(loadBeforeRecords !== undefined ? { loadBeforeRecords } : {}),
  })

  return definition
}
