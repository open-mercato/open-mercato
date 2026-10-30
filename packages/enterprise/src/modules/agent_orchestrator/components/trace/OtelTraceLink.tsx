"use client"

import * as React from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunOtelLinkView } from '../types'

/**
 * The run's trace in the deployment's tracing backend: an icon link that opens
 * it in a new tab and the exported trace id, copyable for searching by hand.
 */
export function OtelTraceLink({ link }: { link: RunOtelLinkView }) {
  const t = useT()
  const copy = React.useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(link.traceId).then(
      () => flash(t('agent_orchestrator.traces.detail.otel.copied', 'Trace ID copied.'), 'success'),
      () => flash(t('agent_orchestrator.traces.detail.otel.copyFailed', 'Could not copy the trace ID.'), 'error'),
    )
  }, [link.traceId, t])
  const openLabel = t('agent_orchestrator.traces.detail.otel.open', 'Open in tracing backend')
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5" data-testid="otel-trace-link">
      <span className="text-xs text-muted-foreground">{t('agent_orchestrator.traces.detail.otel.traceId', 'Trace ID')}</span>
      <SimpleTooltip content={link.traceId}>
        <span className="max-w-32 truncate font-mono text-xs text-foreground">{link.traceId}</span>
      </SimpleTooltip>
      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        onClick={copy}
        aria-label={t('agent_orchestrator.traces.detail.otel.copy', 'Copy trace ID')}
      >
        <Copy className="size-3.5" />
      </IconButton>
      <SimpleTooltip side="bottom" content={openLabel}>
        <IconButton asChild variant="ghost" size="xs">
          <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={openLabel}>
            <ExternalLink className="size-3.5" />
          </a>
        </IconButton>
      </SimpleTooltip>
    </span>
  )
}

export default OtelTraceLink
