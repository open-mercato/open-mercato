"use client"

import * as React from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'
import { extractIncidentAiFailure, resolveIncidentAiErrorMessage } from '../../../lib/aiErrors'
import { AiUnavailableNotice } from '../components/AiUnavailableNotice'
import { useIncidentAiAvailability } from '../components/useAiAvailability'
import { SimilarIncidentsCard, type SimilarIncident } from '../[id]/SimilarIncidentsCard'

type IncidentPriority = 'low' | 'medium' | 'high' | 'critical'

export type IncidentTriageSuggestionKeys = {
  severityKey?: string | null
  typeKey?: string | null
  priorityKey?: string | null
}

type TriageAssistProps = {
  title: string
  description: string
  disabled?: boolean
  onApplySuggestion: (suggestion: IncidentTriageSuggestionKeys) => void | Promise<void>
}

type CatalogItem = {
  id: string
  key?: string | null
  label?: string | null
  is_active?: boolean | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type TriageSuggestionResponse = {
  severityKey?: string | null
  typeKey?: string | null
  priorityKey?: string | null
  rationale?: string | null
  possibleDuplicateIds?: string[]
}

type TriageSimilarIncidentResponse = {
  id?: string | null
  title?: string | null
  number?: string | null
  status?: string | null
}

type TriageSuccessResponse = {
  suggestion?: TriageSuggestionResponse | null
  similar?: TriageSimilarIncidentResponse[]
}

type TriageFailureResponse = {
  error?: string
  code?: string
}

type TriageApiResponse = TriageSuccessResponse | TriageFailureResponse

type SuggestedValue = {
  key: string
  label: string
}

type DuplicateLink = {
  id: string
  label: string
}

type DisplaySuggestion = {
  keys: IncidentTriageSuggestionKeys
  severity: SuggestedValue | null
  type: SuggestedValue | null
  priority: SuggestedValue | null
  rationale: string
  duplicates: DuplicateLink[]
}

type FieldRow = {
  id: 'severity' | 'type' | 'priority'
  label: string
  value: string
}

const emptyCatalogResponse = (): PagedResponse<CatalogItem> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  totalPages: 0,
})

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function loadCatalogItems(path: string): Promise<CatalogItem[]> {
  const result = await apiCall<PagedResponse<CatalogItem>>(
    `${path}?page=1&pageSize=100&isActive=true`,
    undefined,
    { fallback: emptyCatalogResponse() },
  )
  if (!result.ok || !result.result) return []
  return result.result.items.filter((item) => item.id)
}

function isIncidentPriority(value: string | null | undefined): value is IncidentPriority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function priorityLabel(t: ReturnType<typeof useT>, priority: IncidentPriority): string {
  if (priority === 'low') return t('incidents.incident.priority.low', 'Low')
  if (priority === 'medium') return t('incidents.incident.priority.medium', 'Medium')
  if (priority === 'high') return t('incidents.incident.priority.high', 'High')
  return t('incidents.incident.priority.critical', 'Critical')
}

function catalogValueForKey(
  items: readonly CatalogItem[],
  kind: 'severity' | 'type',
  key: string | null | undefined,
  t: ReturnType<typeof useT>,
): SuggestedValue | null {
  const normalized = readString(key)
  if (!normalized) return null
  const item = items.find((entry) => entry.key?.trim() === normalized)
  if (!item) return null
  return {
    key: normalized,
    label: resolveCatalogLabel(t, kind, item.key, item.label ?? item.id),
  }
}

function priorityValueForKey(key: string | null | undefined, t: ReturnType<typeof useT>): SuggestedValue | null {
  const normalized = readString(key)
  if (!isIncidentPriority(normalized)) return null
  return { key: normalized, label: priorityLabel(t, normalized) }
}

function duplicateLabel(item: TriageSimilarIncidentResponse, id: string): string {
  const number = readString(item.number)
  const title = readString(item.title)
  if (number && title) return `${number} - ${title}`
  return number ?? title ?? id
}

function normalizeDuplicates(
  possibleDuplicateIds: readonly string[] | undefined,
  similar: readonly TriageSimilarIncidentResponse[],
): DuplicateLink[] {
  const labelsById = new Map<string, string>()
  const orderedIds: string[] = []
  similar.forEach((item) => {
    const id = readString(item.id)
    if (!id) return
    labelsById.set(id, duplicateLabel(item, id))
  })
  possibleDuplicateIds?.forEach((value) => {
    const id = readString(value)
    if (!id || orderedIds.includes(id)) return
    orderedIds.push(id)
  })
  similar.forEach((item) => {
    const id = readString(item.id)
    if (!id || orderedIds.includes(id)) return
    orderedIds.push(id)
  })
  return orderedIds.map((id) => ({ id, label: labelsById.get(id) ?? id }))
}

function isTriageSuccessResponse(result: TriageApiResponse | null): result is TriageSuccessResponse {
  return result !== null && ('suggestion' in result || 'similar' in result)
}

function buildDisplaySuggestion(
  suggestion: TriageSuggestionResponse,
  similar: readonly TriageSimilarIncidentResponse[],
  severities: readonly CatalogItem[],
  types: readonly CatalogItem[],
  t: ReturnType<typeof useT>,
): DisplaySuggestion {
  const severity = catalogValueForKey(severities, 'severity', suggestion.severityKey, t)
  const type = catalogValueForKey(types, 'type', suggestion.typeKey, t)
  const priority = priorityValueForKey(suggestion.priorityKey, t)
  return {
    keys: {
      severityKey: severity?.key ?? null,
      typeKey: type?.key ?? null,
      priorityKey: priority?.key ?? null,
    },
    severity,
    type,
    priority,
    rationale: readString(suggestion.rationale) ?? t('incidents.ai.triage.rationaleFallback', 'Review the suggested fields before creating the incident.'),
    duplicates: normalizeDuplicates(suggestion.possibleDuplicateIds, similar),
  }
}

function fieldRowsForSuggestion(suggestion: DisplaySuggestion | null, t: ReturnType<typeof useT>): FieldRow[] {
  const rows: FieldRow[] = []
  if (suggestion?.severity) {
    rows.push({ id: 'severity', label: t('incidents.ai.triage.fields.severity', 'Severity'), value: suggestion.severity.label })
  }
  if (suggestion?.type) {
    rows.push({ id: 'type', label: t('incidents.ai.triage.fields.type', 'Type'), value: suggestion.type.label })
  }
  if (suggestion?.priority) {
    rows.push({ id: 'priority', label: t('incidents.ai.triage.fields.priority', 'Priority'), value: suggestion.priority.label })
  }
  return rows
}

export function TriageAssist({ title, description, disabled = false, onApplySuggestion }: TriageAssistProps) {
  const t = useT()
  const { available, reason } = useIncidentAiAvailability()
  const [pending, setPending] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [suggestion, setSuggestion] = React.useState<DisplaySuggestion | null>(null)
  const [similar, setSimilar] = React.useState<SimilarIncident[]>([])
  const normalizedTitle = title.trim()
  const normalizedDescription = description.trim()
  const fieldRows = fieldRowsForSuggestion(suggestion, t)
  const canApply = fieldRows.length > 0

  const showFailure = React.useCallback((status: number | null, body: unknown) => {
    flash(
      resolveIncidentAiErrorMessage(
        extractIncidentAiFailure(status, body),
        t,
        'incidents.ai.triage.errors.generic',
        'AI could not suggest incident fields. Try again.',
      ),
      'error',
    )
  }, [t])

  const handleSuggest = React.useCallback(async () => {
    if (!normalizedTitle || pending) return
    setPending(true)
    try {
      const call = await apiCall<TriageApiResponse>('/api/incidents/ai/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: normalizedTitle,
          description: normalizedDescription || undefined,
        }),
      })
      if (!call.ok) {
        showFailure(call.status, call.result)
        return
      }
      if (!isTriageSuccessResponse(call.result)) {
        showFailure(call.status, call.result)
        return
      }
      const responseSimilar = (call.result.similar ?? []).filter(
        (item): item is SimilarIncident => typeof item.id === 'string' && item.id.length > 0,
      )
      setSimilar(responseSimilar)
      const responseSuggestion = call.result.suggestion ?? null
      if (!responseSuggestion) {
        setSuggestion(null)
        flash(t('incidents.ai.triage.noSuggestion', 'AI could not suggest incident fields from this title and description.'), 'info')
        return
      }
      const [severities, types] = await Promise.all([
        loadCatalogItems('/api/incidents/severities').catch(() => []),
        loadCatalogItems('/api/incidents/types').catch(() => []),
      ])
      setSuggestion(buildDisplaySuggestion(responseSuggestion, call.result.similar ?? [], severities, types, t))
    } catch {
      showFailure(null, null)
    } finally {
      setPending(false)
    }
  }, [normalizedDescription, normalizedTitle, pending, showFailure, t])

  const handleApply = React.useCallback(async () => {
    if (!suggestion || applying || !canApply) return
    setApplying(true)
    try {
      await onApplySuggestion(suggestion.keys)
    } catch {
      flash(t('incidents.ai.triage.applyFailed', 'Could not apply the AI suggestion.'), 'error')
    } finally {
      setApplying(false)
    }
  }, [applying, canApply, onApplySuggestion, suggestion, t])

  const similarCard = (
    <SimilarIncidentsCard title={title} providedIncidents={similar.length > 0 ? similar : undefined} compact />
  )

  if (available === false && reason) {
    return (
      <div className="space-y-3">
        <AiUnavailableNotice reason={reason} />
        {similarCard}
      </div>
    )
  }
  if (available !== true) return similarCard

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        onClick={() => void handleSuggest()}
        disabled={disabled || pending || normalizedTitle.length === 0}
        className="w-full sm:w-auto"
      >
        {pending ? <Spinner size="sm" /> : <Sparkles className="size-4" aria-hidden="true" />}
        {pending ? t('incidents.ai.triage.suggesting', 'Suggesting') : t('incidents.ai.triage.suggestWithAi', 'Suggest with AI')}
      </Button>
      {suggestion ? (
        <section className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">
                  {t('incidents.ai.triage.suggestion.title', 'AI suggestion')}
                </h3>
              </div>
              {fieldRows.length > 0 ? (
                <dl className="grid gap-2 sm:grid-cols-3">
                  {fieldRows.map((row) => (
                    <div key={row.id} className="rounded-md border border-border bg-background px-3 py-2">
                      <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                      <dd className="truncate text-sm font-medium text-foreground" title={row.value}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="truncate text-sm text-muted-foreground" title={suggestion.rationale}>
                {suggestion.rationale}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleApply()}
              disabled={applying || !canApply}
              className="w-full sm:w-auto"
            >
              {applying ? <Spinner size="sm" /> : null}
              {applying ? t('incidents.ai.triage.applying', 'Applying') : t('incidents.ai.triage.apply', 'Apply')}
            </Button>
          </div>
          {suggestion.duplicates.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('incidents.ai.triage.duplicates', 'Possible duplicates')}
              </p>
              <ul className="mt-2 space-y-2">
                {suggestion.duplicates.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/backend/incidents/${encodeURIComponent(item.id)}`}
                      className="block truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {similarCard}
    </div>
  )
}
