'use client'

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { entryHref, type PreviewMode } from '@/lib/links'
import { isPreviewHeightMessage } from '@/lib/preview-protocol'
import {
  FRAME_INITIAL_HEIGHT,
  STATE_WIDTHS,
  WIDE_SCREEN_QUERY,
  buildStateRows,
  clampFrameHeight,
  defaultStateWidths,
  frameScale,
  matrixLayout,
  scaledFrameHeight,
  toggleStateWidth,
  type StateWidth,
} from '@/lib/states-matrix'
import { useDesignSettings } from './DesignSettings'

const NEAR_VIEWPORT_MARGIN = '600px 0px'
const READY_FALLBACK_MS = 4000

type StatesMatrixProps = {
  entryId: string
  group: string
  title: string
  variants: ReadonlyArray<{ id: string; title: string }>
  onOpenVariant: (variantId: string) => void
}

type StateFrameProps = {
  src: string
  title: string
  viewportWidth: number
  columnWidth: number
}

function StateFrame({ src, title, viewportWidth, columnWidth }: StateFrameProps) {
  const boxRef = React.useRef<HTMLDivElement>(null)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [near, setNear] = React.useState(false)
  const [readySrc, setReadySrc] = React.useState<string | null>(null)
  const [height, setHeight] = React.useState(FRAME_INITIAL_HEIGHT)
  const ready = near && readySrc === src

  React.useEffect(() => {
    const node = boxRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries[entries.length - 1]
        if (latest) setNear(latest.isIntersecting)
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!near) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      if (!isPreviewHeightMessage(event.data)) return
      setHeight(clampFrameHeight(event.data.height))
      setReadySrc(src)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      setReadySrc(null)
    }
  }, [near, src])

  const onLoad = () => {
    window.setTimeout(() => setReadySrc((current) => current ?? src), READY_FALLBACK_MS)
  }

  const scale = frameScale(columnWidth, viewportWidth)
  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden rounded-lg border border-border bg-background"
      style={{ width: columnWidth, height: scaledFrameHeight(height, scale) }}
    >
      {near ? (
        <iframe
          key={src}
          ref={iframeRef}
          title={title}
          src={src}
          onLoad={onLoad}
          className={cn('absolute left-0 top-0 block max-w-none border-0 transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
          style={{ width: viewportWidth, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      ) : null}
      {ready ? null : <Skeleton className="absolute inset-0 size-full rounded-none" />}
    </div>
  )
}

function useWideScreen(): boolean {
  const [wide, setWide] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia(WIDE_SCREEN_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setWidth(Math.floor(node.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function StatesMatrix({ entryId, group, title, variants, onOpenVariant }: StatesMatrixProps) {
  const t = useT()
  const settings = useDesignSettings()
  const wideScreen = useWideScreen()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const available = useElementWidth(containerRef)
  const [chosenMode, setChosenMode] = React.useState<PreviewMode | null>(null)
  const [chosenWidths, setChosenWidths] = React.useState<StateWidth[] | null>(null)

  const mode = chosenMode ?? settings.mode
  const widths = chosenWidths ?? defaultStateWidths(wideScreen)
  const { stacked, columns } = matrixLayout(available, widths)
  const rows = buildStateRows(entryId, variants, widths, mode)
  const modeLabel = t(mode === 'dark' ? 'design.states.dark' : 'design.states.light')
  const labelClass = 'text-sm text-muted-foreground'

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('design.states.lead')}</p>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <span id="states-mode-label" className={labelClass}>{t('design.states.modeLabel')}</span>
          <SegmentedControl
            className="om-design-switch"
            size="sm"
            aria-labelledby="states-mode-label"
            value={mode}
            onValueChange={(value) => setChosenMode(value === 'dark' ? 'dark' : 'light')}
          >
            <SegmentedControlItem value="light">{t('design.states.light')}</SegmentedControlItem>
            <SegmentedControlItem value="dark">{t('design.states.dark')}</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <div className="flex items-center gap-3">
          <span id="states-widths-label" className={labelClass}>{t('design.states.widthsLabel')}</span>
          <div role="group" aria-labelledby="states-widths-label" className="flex flex-wrap items-center gap-1">
            {STATE_WIDTHS.map((width) => {
              const active = widths.includes(width)
              return (
                <Button
                  key={width}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setChosenWidths(toggleStateWidth(widths, width))}
                  className={cn('font-normal', active ? 'bg-accent text-foreground' : 'text-muted-foreground')}
                >
                  {width}
                </Button>
              )
            })}
          </div>
        </div>
      </div>
      <div ref={containerRef} className="min-w-0">
        {available > 0 ? (
          <div role="table" aria-label={t('design.states.tableLabel', { title })} className="min-w-full">
            <div role="rowgroup">
              <div role="row" className="sr-only">
                <span role="columnheader">{t('design.states.columnExample')}</span>
                {widths.map((width) => (
                  <span key={width} role="columnheader">{t('design.frame.widthValue', { width })}</span>
                ))}
              </div>
            </div>
            <div role="rowgroup">
              {rows.map((row) => (
                <div key={row.variantId} role="row" className={cn('flex flex-wrap items-start gap-x-4 border-t border-border py-6', stacked ? 'gap-y-6' : 'gap-y-2')}>
                  <div role="rowheader" className="basis-full text-base text-foreground">
                    <a
                      href={`${entryHref(group, entryId)}#variant-${row.variantId}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
                        event.preventDefault()
                        onOpenVariant(row.variantId)
                      }}
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.title}
                    </a>
                  </div>
                  {row.cells.map((cell, index) => (
                    <div key={cell.width} role="cell" className="shrink-0 space-y-1" style={{ width: columns[index] }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">{t('design.frame.widthValue', { width: cell.width })}</span>
                        <a
                          href={cell.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus"
                          aria-label={t('design.states.open', { title: row.title, width: cell.width })}
                          title={t('design.states.open', { title: row.title, width: cell.width })}
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                      </div>
                      <StateFrame
                        src={cell.href}
                        title={t('design.states.frameTitle', { title: row.title, width: cell.width, mode: modeLabel })}
                        viewportWidth={cell.width}
                        columnWidth={columns[index]}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
