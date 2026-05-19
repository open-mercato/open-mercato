/**
 * Safe, user-visible task-plan labels for AI chat.
 *
 * These helpers intentionally reject text that looks like private reasoning.
 * Task plans are UI copy for operators, not a channel for model scratchpads.
 */

export const TASK_PLAN_TOOL_NAME = 'meta.update_task_plan'
export const TASK_PLAN_TOOL_NAME_SDK = 'meta__update_task_plan'
export const TASK_PLAN_MAX_TASKS = 8
export const TASK_PLAN_LABEL_MAX_CHARS = 80
export const TASK_PLAN_DETAIL_MAX_CHARS = 160
export const TASK_PLAN_ID_MAX_CHARS = 80
export const TASK_PLAN_TOOL_NAME_MAX_CHARS = 160

export interface SanitizedAgentTaskPlanInputTask {
  id?: string
  label: string
  detail?: string
  toolName?: string
}

export interface SanitizedAgentTaskPlanInput {
  tasks: SanitizedAgentTaskPlanInputTask[]
}

export const TASK_PLAN_RUNTIME_PROMPT_SECTION = [
  'TASK PLAN (RUNTIME)',
  'For every tool-using turn, first call `meta.update_task_plan` with 2-5 concise user-visible steps. Then call the domain/search/attachment/mutation tools.',
  'Task labels are visible progress UI. Never include hidden reasoning, chain-of-thought, scratchpad notes, or XML thinking tags.',
  'When a planned step maps to a known tool, include `toolName` so the chat can advance that row from pending to running to done.',
  'Skip `meta.update_task_plan` for pure capability, example-question, or how-can-you-help prompts where no data tool is needed.',
].join('\n')

const HIDDEN_REASONING_PATTERNS: RegExp[] = [
  /\bchain[-\s]?of[-\s]?thought\b/i,
  /\binternal\s+(?:reasoning|thoughts?)\b/i,
  /\bprivate\s+(?:reasoning|thoughts?)\b/i,
  /\bhidden\s+(?:reasoning|thoughts?)\b/i,
  /\bscratch\s*pad\b/i,
  /\bscratchpad\b/i,
  /\b(?:my\s+)?reasoning\s*:/i,
  /<\/?\s*(?:thinking|thought|reasoning|scratchpad)\b/i,
]

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const WHITESPACE = /\s+/g

export function normalizeTaskPlanToolName(toolName: unknown): string | undefined {
  if (typeof toolName !== 'string') return undefined
  const trimmed = toolName.trim()
  if (!trimmed) return undefined
  const dotted = trimmed.replace(/__/g, '.')
  const safe = dotted.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, TASK_PLAN_TOOL_NAME_MAX_CHARS)
  return safe.length > 0 ? safe : undefined
}

export function isTaskPlanToolName(toolName: unknown): boolean {
  return normalizeTaskPlanToolName(toolName) === TASK_PLAN_TOOL_NAME
}

export function looksLikeHiddenReasoning(value: string): boolean {
  return HIDDEN_REASONING_PATTERNS.some((pattern) => pattern.test(value))
}

export function sanitizeTaskPlanText(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(CONTROL_CHARS, ' ').replace(WHITESPACE, ' ').trim()
  if (!normalized) return null
  if (looksLikeHiddenReasoning(normalized)) return null
  return normalized.slice(0, maxChars)
}

export function sanitizeTaskPlanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, TASK_PLAN_ID_MAX_CHARS)
  return normalized.length > 0 ? normalized : undefined
}

export function sanitizeAgentTaskPlanInput(input: unknown): SanitizedAgentTaskPlanInput {
  if (!input || typeof input !== 'object') {
    return { tasks: [] }
  }
  const rawTasks = (input as { tasks?: unknown }).tasks
  if (!Array.isArray(rawTasks)) {
    return { tasks: [] }
  }
  const tasks: SanitizedAgentTaskPlanInputTask[] = []
  for (const rawTask of rawTasks.slice(0, TASK_PLAN_MAX_TASKS)) {
    if (!rawTask || typeof rawTask !== 'object') continue
    const value = rawTask as Record<string, unknown>
    const label = sanitizeTaskPlanText(value.label, TASK_PLAN_LABEL_MAX_CHARS)
    if (!label) continue
    const detail = sanitizeTaskPlanText(value.detail, TASK_PLAN_DETAIL_MAX_CHARS) ?? undefined
    const id = sanitizeTaskPlanId(value.id)
    const toolName = normalizeTaskPlanToolName(value.toolName)
    tasks.push({
      ...(id ? { id } : {}),
      label,
      ...(detail ? { detail } : {}),
      ...(toolName ? { toolName } : {}),
    })
  }
  return { tasks }
}
