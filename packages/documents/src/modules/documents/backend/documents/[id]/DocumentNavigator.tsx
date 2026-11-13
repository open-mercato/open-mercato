"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PagePosition = { currentPage: number; totalPages: number }

export function pageAtOffset(pageTops: number[], offset: number): PagePosition {
  if (pageTops.length === 0) return { currentPage: 1, totalPages: 1 }
  let low = 0
  let high = pageTops.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((pageTops[middle] ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1
    else high = middle
  }
  return { currentPage: Math.max(1, low), totalPages: pageTops.length }
}

function documentScroller(editor: Editor): HTMLElement | null {
  return editor.view.dom.closest<HTMLElement>('.om-doc-canvas')
}

function collectPageTops(editor: Editor, scroller: HTMLElement): number[] {
  const paper = editor.view.dom.closest<HTMLElement>('.om-doc-paper')
  if (!paper) return []
  const scrollerTop = scroller.getBoundingClientRect().top
  const tops = [paper.getBoundingClientRect().top - scrollerTop + scroller.scrollTop]
  paper.querySelectorAll<HTMLElement>('[data-document-page-start]').forEach((pageStart) => {
    tops.push(pageStart.getBoundingClientRect().top - scrollerTop + scroller.scrollTop)
  })
  return tops
}

export function DocumentNavigator({ editor }: { editor: Editor | null }) {
  const t = useT()
  const pageTopsRef = React.useRef<number[]>([])
  const pageStartsRef = React.useRef<HTMLElement[]>([])
  const frameRef = React.useRef<number | null>(null)
  const [position, setPosition] = React.useState<PagePosition>({ currentPage: 1, totalPages: 1 })
  const [targetPage, setTargetPage] = React.useState('')

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const scroller = documentScroller(editor)
    if (!scroller) return
    const readCurrentPage = () => {
      frameRef.current = null
      const anchor = scroller.scrollTop + Math.min(160, scroller.clientHeight * 0.25)
      const next = pageAtOffset(pageTopsRef.current, anchor)
      setPosition((current) => current.currentPage === next.currentPage && current.totalPages === next.totalPages ? current : next)
    }
    const scheduleCurrentPage = () => {
      if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(readCurrentPage)
    }
    const refreshPageTops = () => {
      pageTopsRef.current = collectPageTops(editor, scroller)
      pageStartsRef.current = Array.from(editor.view.dom.closest<HTMLElement>('.om-doc-paper')?.querySelectorAll<HTMLElement>('[data-document-page-start]') ?? [])
      scheduleCurrentPage()
    }
    const mutationObserver = new MutationObserver(refreshPageTops)
    mutationObserver.observe(editor.view.dom, { childList: true, subtree: true })
    const paper = editor.view.dom.closest<HTMLElement>('.om-doc-paper')
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refreshPageTops)
    if (paper) resizeObserver?.observe(paper)
    scroller.addEventListener('scroll', scheduleCurrentPage, { passive: true })
    window.addEventListener('resize', refreshPageTops)
    refreshPageTops()
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      scroller.removeEventListener('scroll', scheduleCurrentPage)
      window.removeEventListener('resize', refreshPageTops)
    }
  }, [editor])

  const jumpToPage = React.useCallback(() => {
    const requested = Number.parseInt(targetPage, 10)
    if (!Number.isFinite(requested)) return
    const page = Math.min(position.totalPages, Math.max(1, requested))
    const scroller = editor && !editor.isDestroyed ? documentScroller(editor) : null
    const top = pageTopsRef.current[page - 1]
    if (!scroller || top === undefined || (page > 1 && !pageStartsRef.current[page - 2])) return
    scroller.scrollTo({ top: Math.max(0, top - 24), behavior: 'auto' })
    setTargetPage('')
  }, [editor, position.totalPages, targetPage])
  const progress = Math.round((position.currentPage / position.totalPages) * 100)

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-label={t('documents.editor.navigation.title')}>
      <div>
        <h2 className="text-sm font-semibold">{t('documents.editor.navigation.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('documents.editor.navigation.pageStatus', position)}</p>
      </div>
      <Progress
        value={progress}
        label={t('documents.editor.navigation.progress')}
        showValue
        aria-label={t('documents.editor.navigation.progress')}
      />
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); jumpToPage() }}>
        <Label htmlFor="documents-page-target">{t('documents.editor.navigation.goToPage')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="documents-page-target"
            type="number"
            inputMode="numeric"
            min={1}
            max={position.totalPages}
            value={targetPage}
            onChange={(event) => setTargetPage(event.target.value)}
            placeholder={String(position.currentPage)}
            aria-describedby="documents-page-range"
          />
          <Button type="submit" disabled={!targetPage.trim()}>{t('documents.editor.navigation.go')}</Button>
        </div>
        <p id="documents-page-range" className="text-xs text-muted-foreground">
          {t('documents.editor.navigation.pageRange', { totalPages: position.totalPages })}
        </p>
      </form>
    </section>
  )
}
