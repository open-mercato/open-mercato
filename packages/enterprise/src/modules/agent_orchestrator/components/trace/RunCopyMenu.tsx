"use client"

import * as React from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunView, SpanView } from '../types'
import { buildArtifactUrl, classifyArtifactResponse } from './llmStepContent'
import { buildRunMetadataCopy, collectRunContent, type ArtifactFetcher } from './runCompareView'

export type RunCopyMenuProps = {
  run: RunView
  spans: readonly SpanView[]
  canViewContent: boolean | null
}

async function writeClipboard(value: unknown): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!clipboard) return false
  try {
    await clipboard.writeText(JSON.stringify(value, null, 2))
    return true
  } catch {
    return false
  }
}

export function RunCopyMenu({ run, spans, canViewContent }: RunCopyMenuProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const fetchArtifact = React.useCallback<ArtifactFetcher>(
    async (kind, key) => {
      const call = await apiCall<{ payload?: unknown }>(buildArtifactUrl(run.id, kind, key), undefined, {
        fallback: null,
      })
      return classifyArtifactResponse(call.ok, call.status, call.result?.payload ?? null)
    },
    [run.id],
  )

  const copy = React.useCallback(
    async (withContent: boolean) => {
      setOpen(false)
      setBusy(true)
      try {
        const metadata = buildRunMetadataCopy(run, spans)
        const payload = withContent ? { ...metadata, content: await collectRunContent(spans, fetchArtifact) } : metadata
        const copied = await writeClipboard(payload)
        flash(t(copied ? 'agent_orchestrator.trace.copied' : 'agent_orchestrator.trace.copyFailed'), copied ? 'success' : 'error')
      } catch {
        flash(t('agent_orchestrator.trace.copyFailed'), 'error')
      } finally {
        setBusy(false)
      }
    },
    [fetchArtifact, run, spans, t],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy} data-testid="run-copy-menu">
          <Copy className="size-4" />
          {t('agent_orchestrator.trace.copyRun')}
          <ChevronDown className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => void copy(false)}
            data-testid="run-copy-metadata"
          >
            {t('agent_orchestrator.trace.copyRunMetadata')}
          </Button>
          {canViewContent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => void copy(true)}
              data-testid="run-copy-content"
            >
              {t('agent_orchestrator.trace.copyRunWithContent')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default RunCopyMenu
