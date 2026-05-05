import type { AiToolDefinition } from './types'

export function defineAiTool<TInput = unknown, TOutput = unknown>(
  tool: AiToolDefinition<TInput, TOutput>,
): AiToolDefinition<TInput, TOutput> {
  return tool
}
