'use client'

import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { previewHref } from '@/lib/links'
import { clampWidth, isPreviewHeightMessage } from '@/lib/preview-protocol'
import { STATE_WIDTHS } from '@/lib/states-matrix'
import { useDesignSettings } from './DesignSettings'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

export const QUICK_WIDTHS = STATE_WIDTHS
const MIN_WIDTH = 320
const KEYBOARD_STEP = 16
const INITIAL_HEIGHT = 160

type PreviewFrameProps = {
  entryId: string
  variantId: string
  title: string
}

const resizableVariants: Readonly<Partial<Record<string, readonly string[]>>> = {
  stack: ['wrapping', 'spread'],
  'key-value': ['two-columns', 'editable'],
  'entity-header': ['default', 'with-slots'],
  'detail-fields-section': ['field-grid'],
  'filter-bar': ['inline', 'trailing-items'],
  'filter-toolbar': ['table', 'calendar'],
  'section-page': ['section-nav'],
  page: ['basic', 'with-actions'],
  table: ['default', 'with-footer'],
  splitter: ['basic', 'vertical', 'nested'],
  'border-beam': ['basic'],
  'schedule-grid': ['three-day-board'],
  'schedule-view': ['week', 'month'],
}

export function PreviewFrame({ entryId, variantId, title, attached = false }: PreviewFrameProps & { attached?: boolean }) {
  const t = useT()
  const { mode } = useDesignSettings()
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(INITIAL_HEIGHT)

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      if (!isPreviewHeightMessage(event.data)) return
      setHeight(Math.max(INITIAL_HEIGHT / 2, Math.ceil(event.data.height)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const frame = (
    <div className={attached ? 'overflow-hidden bg-background' : 'overflow-hidden rounded-xl border border-border bg-background'}>
      <iframe
        ref={iframeRef}
        title={t('design.frame.title', { title })}
        src={previewHref(entryId, variantId, mode)}
        loading="lazy"
        className="block w-full border-0"
        style={{ height }}
      />
    </div>
  )
  return resizableVariants[entryId]?.includes(variantId)
    ? <ResizablePreview>{frame}</ResizablePreview>
    : frame
}

const FIT_VALUE = 'fit'

function ResizablePreview({ children }: { children: React.ReactNode }) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const [available, setAvailable] = React.useState(0)
  const [requested, setRequested] = React.useState<number | null>(null)

  React.useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const update = () => setAvailable(Math.floor(node.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const width = available > 0 ? clampWidth(requested ?? available, MIN_WIDTH, available) : undefined

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!width) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: width }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setRequested(clampWidth(drag.startWidth + (event.clientX - drag.startX), MIN_WIDTH, available))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!width) return
    if (event.key === 'ArrowLeft') setRequested(clampWidth(width - KEYBOARD_STEP, MIN_WIDTH, available))
    else if (event.key === 'ArrowRight') setRequested(clampWidth(width + KEYBOARD_STEP, MIN_WIDTH, available))
    else if (event.key === 'Home') setRequested(MIN_WIDTH)
    else if (event.key === 'End') setRequested(null)
    else return
    event.preventDefault()
  }

  return (
    <div className="min-w-0">
      <div className="hidden items-center justify-between gap-3 border-b border-border bg-card px-3 py-2 sm:flex">
        <SegmentedControl
          size="sm"
          aria-label={t('design.frame.widthLabel')}
          value={requested === null ? FIT_VALUE : String(requested)}
          onValueChange={(value) => setRequested(value === FIT_VALUE ? null : Number(value))}
        >
          <SegmentedControlItem value={FIT_VALUE}>{t('design.frame.full')}</SegmentedControlItem>
          {QUICK_WIDTHS.filter((quickWidth) => available === 0 || quickWidth <= available).map((quickWidth) => (
            <SegmentedControlItem key={quickWidth} value={String(quickWidth)}>{quickWidth}</SegmentedControlItem>
          ))}
        </SegmentedControl>
        {width ? <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{t('design.frame.widthValue', { width })}</span> : null}
      </div>
      <div ref={containerRef} className="min-w-0">
        <div className="relative max-w-full" style={width ? { width } : undefined}>
          {children}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('design.frame.handle')}
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={available || undefined}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className="group absolute inset-y-0 right-0 hidden w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none sm:flex"
          >
            <span className="flex h-10 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs transition-colors group-hover:text-foreground group-focus-visible:shadow-focus">
              <GripVertical className="size-3.5" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
