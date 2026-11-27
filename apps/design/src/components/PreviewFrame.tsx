'use client'

import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { previewHref } from '@/lib/links'
import { clampWidth, isPreviewHeightMessage } from '@/lib/preview-protocol'
import { STATE_WIDTHS } from '@/lib/states-matrix'
import { useDesignSettings } from './DesignSettings'

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

export function PreviewFrame({ entryId, variantId, title }: PreviewFrameProps) {
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
    <div className="overflow-hidden rounded-xl border border-border bg-background">
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
    <div className="min-w-0 space-y-2">
      <div className="hidden flex-wrap items-center gap-1 sm:flex" role="group" aria-label={t('design.frame.widthLabel')}>
        <span className="flex flex-wrap items-center gap-1">
          <WidthButton active={requested === null} onClick={() => setRequested(null)}>{t('design.frame.full')}</WidthButton>
          {QUICK_WIDTHS.map((quickWidth) => (
            <WidthButton
              key={quickWidth}
              active={requested === quickWidth}
              disabled={available > 0 && quickWidth > available}
              onClick={() => setRequested(quickWidth)}
            >
              {quickWidth}
            </WidthButton>
          ))}
        </span>
        {width ? <span className="ml-auto text-xs text-muted-foreground">{t('design.frame.widthValue', { width })}</span> : null}
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
            className="group absolute inset-y-0 -right-2 hidden w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none sm:flex"
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

function WidthButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="2xs"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn('font-normal', active ? 'bg-accent text-foreground' : 'text-muted-foreground')}
    >
      {children}
    </Button>
  )
}
