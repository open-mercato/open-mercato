"use client"

import * as React from 'react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../types'
import { InspectorCard } from './InspectorCard'
import type { ArtifactCaptureFailure } from '../../lib/trace/artifactCaptureStatus'

type RunArtifactRow = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  caption: string | null
  promotedAttachmentId: string | null
  createdAt: string
}

type RunArtifactsResponse = { items: RunArtifactRow[]; captureFailure?: ArtifactCaptureFailure | null }

type FilesState = { rows: RunArtifactRow[]; captureFailure: ArtifactCaptureFailure | null }

function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * File plane (#12): files the agent produced during the run (AgentRunArtifact),
 * fetched from the dedicated list endpoint and downloadable, plus a warning when
 * some produced files were not stored (count + reason, never file names).
 * Distinct from the trace `ArtifactExpander` (offloaded tool-call payloads).
 */
export function RunFilesCard({ runId }: { runId: string }) {
  const t = useT()
  const locale = useLocale()
  const [state, setState] = React.useState<FilesState | null>(null)
  React.useEffect(() => {
    let active = true
    void (async () => {
      const call = await apiCall<RunArtifactsResponse>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/artifacts`,
        undefined,
        { fallback: { items: [], captureFailure: null } },
      )
      if (active && call.ok) {
        setState({ rows: call.result?.items ?? [], captureFailure: call.result?.captureFailure ?? null })
      }
    })()
    return () => {
      active = false
    }
  }, [runId])

  if (state != null && state.rows.length === 0 && !state.captureFailure) return null

  return (
    <InspectorCard title={t('agent_orchestrator.artifacts.title')}>
      {state == null ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.artifacts.loading')}</p>
      ) : (
        <div className="space-y-2">
          {state.captureFailure ? (
            <Alert status="warning" data-testid="run-files-capture-failure">
              <AlertDescription>
                {t(`agent_orchestrator.artifacts.captureFailure.${state.captureFailure.reason}`, undefined, {
                  count: state.captureFailure.count,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {state.rows.length > 0 ? (
            <ul className="space-y-2">
              {state.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-foreground">{row.fileName}</span>
                      {row.promotedAttachmentId ? (
                        <span className="rounded-md border border-status-success-border bg-status-success-bg px-1.5 py-0.5 text-xs text-status-success-text">
                          {t('agent_orchestrator.artifacts.promoted')}
                        </span>
                      ) : null}
                    </div>
                    {row.caption ? (
                      <p className="truncate text-xs text-muted-foreground">{row.caption}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatArtifactSize(row.fileSize)} · {formatDateTime(row.createdAt, locale)}
                    </p>
                  </div>
                  <a
                    href={`/api/agent_orchestrator/artifacts/file/${encodeURIComponent(row.id)}?download=1`}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                    aria-label={t('agent_orchestrator.artifacts.download')}
                  >
                    {t('agent_orchestrator.artifacts.download')}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </InspectorCard>
  )
}
