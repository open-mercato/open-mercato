import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type MilestoneSuggestion = { key: string; label: string; steps: string[] }
export type WorkflowMilestones = { recordId: string | null; suggestions: MilestoneSuggestion[] }

export function milestoneDisplayName(key: string): string {
  const words = key.replace(/[_.-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function collectMilestoneSuggestions(definition: unknown): MilestoneSuggestion[] {
  if (!definition || typeof definition !== 'object') return []
  const steps = (definition as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return []
  const suggestions = new Map<string, MilestoneSuggestion>()
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object') continue
    const step = raw as Record<string, unknown>
    const key = typeof step.milestone === 'string' ? step.milestone.trim() : ''
    if (!key) continue
    const name =
      typeof step.stepName === 'string' ? step.stepName : typeof step.stepId === 'string' ? step.stepId : ''
    const suggestion = suggestions.get(key) ?? { key, label: milestoneDisplayName(key), steps: [] }
    if (name && !suggestion.steps.includes(name)) suggestion.steps.push(name)
    suggestions.set(key, suggestion)
  }
  return [...suggestions.values()]
}

export async function fetchWorkflowMilestones(workflowId: string): Promise<WorkflowMilestones | null> {
  let selected: Record<string, unknown> | null = null
  let offset = 0
  while (true) {
    const params = new URLSearchParams({
      workflowId,
      enabled: 'true',
      lifecycle: 'published',
      limit: '100',
      offset: String(offset),
    })
    const call = await apiCall<{ data?: unknown[]; pagination?: { hasMore?: boolean } }>(
      `/api/workflows/definitions?${params}`,
      undefined,
      { fallback: {} },
    )
    if (!call.ok || !Array.isArray(call.result?.data)) return null
    for (const raw of call.result.data) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      if (row.workflowId !== workflowId) continue
      if (!selected || Number(row.version ?? 0) > Number(selected.version ?? 0)) selected = row
    }
    if (!call.result.pagination?.hasMore || call.result.data.length === 0) break
    offset += 100
  }
  if (!selected?.definition || typeof selected.definition !== 'object') return null
  return {
    recordId: typeof selected.id === 'string' ? selected.id : null,
    suggestions: collectMilestoneSuggestions(selected.definition),
  }
}
