"use client"

import * as React from 'react'
import type {
  InjectionStatusBadgeWidget,
  StatusBadgeResult,
  StatusBadgeContext,
} from '@open-mercato/shared/modules/widgets/injection'
import { Badge } from '../../primitives/badge'
import { SimpleTooltip } from '../../primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type StatusBadgeRendererProps = {
  widget: InjectionStatusBadgeWidget
  context: StatusBadgeContext
}

const STATUS_DOT_CLASSES: Record<StatusBadgeResult['status'], string> = {
  healthy: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  unknown: 'bg-gray-400',
}

function StatusDot({ status }: { status: StatusBadgeResult['status'] }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_DOT_CLASSES[status])}
      aria-hidden="true"
    />
  )
}

export function StatusBadgeRenderer({ widget, context }: StatusBadgeRendererProps) {
  const t = useT()
  const [result, setResult] = React.useState<StatusBadgeResult>({ status: 'unknown' })
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true

    const load = () => {
      widget.badge
        .statusLoader(context)
        .then((data) => {
          if (mountedRef.current) setResult(data)
        })
        .catch(() => {
          if (mountedRef.current) setResult({ status: 'unknown' })
        })
    }

    load()

    const intervalMs = (widget.badge.pollInterval ?? 60) * 1000
    const interval = setInterval(load, intervalMs)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [widget.badge, context])

  const label = t(widget.badge.label, widget.badge.label)

  const content = (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <StatusDot status={result.status} />
      <span className="truncate">{label}</span>
      {result.count != null && (
        <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs">
          {result.count}
        </Badge>
      )}
    </span>
  )

  const wrapped = result.tooltip ? (
    <SimpleTooltip content={result.tooltip}>
      {widget.badge.href ? (
        <a href={widget.badge.href} className="inline-flex items-center hover:opacity-80 transition-opacity">
          {content}
        </a>
      ) : (
        <span className="inline-flex items-center">{content}</span>
      )}
    </SimpleTooltip>
  ) : widget.badge.href ? (
    <a href={widget.badge.href} className="inline-flex items-center hover:opacity-80 transition-opacity">
      {content}
    </a>
  ) : (
    content
  )

  return <div className="px-2 py-1">{wrapped}</div>
}

export default StatusBadgeRenderer
