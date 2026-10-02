"use client"

/**
 * Side-by-side comparison of what each configured adapter returns for one query.
 *
 * The ranked list an agent receives is deliberately lossy — dedup, the domain
 * cap and the limit drop hits, and only the first prose answer survives — so it
 * cannot answer "is the paid source earning its keep". This runs the adapters
 * exhaustively and shows each one's own output, which is the only view that can.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PREVIEW_URL = '/api/agent_orchestrator/web-search/preview'

type PreviewHit = {
  url: string
  title: string | null
  snippet: string | null
  blockedByGuardrails: boolean
}

type PreviewAdapter = {
  adapterId: string
  weight: number
  answer: string | null
  results: PreviewHit[]
}

type PreviewDiagnostic = { id: string; status: string; latencyMs: number; resultCount: number; reason?: string }

type PreviewResponse = {
  query?: string
  diagnostics?: { adapters?: PreviewDiagnostic[]; elapsedMs?: number }
  byAdapter?: PreviewAdapter[]
}

const VARIANT_BY_STATUS: Readonly<Record<string, 'success' | 'neutral' | 'warning' | 'error'>> = {
  ok: 'success',
  empty: 'neutral',
  skipped: 'neutral',
  unavailable: 'neutral',
  cancelled: 'neutral',
  blocked: 'warning',
  timeout: 'warning',
  error: 'error',
}

export function WebSearchPreview() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)

  const run = React.useCallback(async () => {
    const trimmed = query.trim()
    if (trimmed.length === 0 || running) return
    setRunning(true)
    setError(null)
    try {
      const call = await apiCall<PreviewResponse>(PREVIEW_URL, {
        method: 'POST',
        body: JSON.stringify({ query: trimmed }),
      })
      if (call.ok && call.result) {
        setPreview(call.result)
      } else {
        setError(t('agent_orchestrator.settings.webSearch.preview.failed', 'The comparison run failed.'))
      }
    } catch {
      setError(t('agent_orchestrator.settings.webSearch.preview.failed', 'The comparison run failed.'))
    } finally {
      setRunning(false)
    }
  }, [query, running, t])

  // Diagnostics are the spine, not `byAdapter`. The engine only reports adapters
  // that produced results, so keying off it would hide exactly the rows an
  // operator is looking for: the source that ran and came back with nothing.
  const resultsById = new Map((preview?.byAdapter ?? []).map((entry) => [entry.adapterId, entry]))
  const rows = (preview?.diagnostics?.adapters ?? []).map((diagnostic) => ({
    diagnostic,
    payload: resultsById.get(diagnostic.id) ?? null,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('agent_orchestrator.settings.webSearch.preview.title', 'Compare adapters')}</CardTitle>
        <CardDescription>
          {t(
            'agent_orchestrator.settings.webSearch.preview.description',
            'Runs every enabled adapter for one query and shows what each returned on its own. Never cached, and it spends real quota on metered sources.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run()
            }}
            placeholder={t(
              'agent_orchestrator.settings.webSearch.preview.placeholder',
              'A query to compare, e.g. best CRM for small teams',
            )}
            className="min-w-64 flex-1"
          />
          <Button onClick={() => void run()} disabled={running || query.trim().length === 0}>
            {running ? <Spinner className="size-4" /> : null}
            {t('agent_orchestrator.settings.webSearch.preview.run', 'Compare')}
          </Button>
        </div>

        {error ? <p className="text-sm text-status-error-fg">{error}</p> : null}

        {rows.length > 0 ? (
          <div className="space-y-3">
            {preview?.diagnostics?.elapsedMs !== undefined ? (
              <p className="text-xs text-muted-foreground">
                {t('agent_orchestrator.settings.webSearch.preview.elapsed', 'Finished in {ms}ms', {
                  ms: String(preview.diagnostics.elapsedMs),
                })}
              </p>
            ) : null}

            {rows.map(({ diagnostic, payload }) => (
              <div key={diagnostic.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{diagnostic.id}</span>
                  <StatusBadge variant={VARIANT_BY_STATUS[diagnostic.status] ?? 'neutral'}>
                    {diagnostic.status}
                  </StatusBadge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t('agent_orchestrator.settings.webSearch.preview.count', '{count} results', {
                      count: String(payload?.results.length ?? 0),
                    })}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{`${diagnostic.latencyMs}ms`}</span>
                </div>

                {diagnostic.reason ? (
                  <p className="mt-1 text-xs text-muted-foreground">{diagnostic.reason}</p>
                ) : null}

                {payload?.answer ? (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{payload.answer}</p>
                ) : null}

                {payload && payload.results.length > 0 ? (
                  <ol className="mt-2 space-y-1">
                    {payload.results.map((hit, index) => (
                      <li key={`${hit.url}:${index}`} className="flex items-baseline gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <a
                          href={hit.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="min-w-0 flex-1 truncate hover:underline"
                          title={hit.title ?? hit.url}
                        >
                          {hit.title ?? hit.url}
                        </a>
                        {hit.blockedByGuardrails ? (
                          <StatusBadge variant="warning">
                            {t('agent_orchestrator.settings.webSearch.preview.blocked', 'Blocked by domain rules')}
                          </StatusBadge>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {preview && rows.length === 0 && !running ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'agent_orchestrator.settings.webSearch.preview.empty',
              'No adapter ran at all. Check the per-adapter health above.',
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default WebSearchPreview
