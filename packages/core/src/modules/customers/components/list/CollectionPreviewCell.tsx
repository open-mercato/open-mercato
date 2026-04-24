"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export function normalizeCollectionLabels(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
}

export function buildCollectionPreview(labels: string[], maxVisible = 2): {
  visibleText: string
  hiddenCount: number
  tooltipText: string
} {
  const normalized = normalizeCollectionLabels(labels)
  if (!normalized.length) {
    return {
      visibleText: '',
      hiddenCount: 0,
      tooltipText: '',
    }
  }

  const cappedVisible = Math.max(1, Math.floor(maxVisible))
  const visible = normalized.slice(0, cappedVisible)
  const hiddenCount = Math.max(0, normalized.length - visible.length)

  return {
    visibleText: visible.join(', '),
    hiddenCount,
    tooltipText: normalized.join(', '),
  }
}

type CollectionPreviewCellProps = {
  labels: string[]
  maxVisible?: number
  className?: string
}

export function CollectionPreviewCell({
  labels,
  maxVisible = 2,
  className,
}: CollectionPreviewCellProps) {
  const { visibleText, hiddenCount, tooltipText } = React.useMemo(
    () => buildCollectionPreview(labels, maxVisible),
    [labels, maxVisible],
  )

  if (!visibleText) return null

  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 text-sm', className)}
      title={tooltipText}
    >
      <span className="min-w-0 truncate">{visibleText}</span>
      {hiddenCount > 0 ? (
        <span className="shrink-0 text-muted-foreground">{`+${hiddenCount}`}</span>
      ) : null}
    </span>
  )
}
