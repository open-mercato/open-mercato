"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Table of contents for long pages. Links scroll to sections on the same
 * page and the link of the section in view is marked with
 * `aria-current="location"`. Pass `offset` when a sticky header covers the
 * top of the page, and `getContainer` when the page scrolls inside an
 * element instead of the window.
 *
 * ```tsx
 * <Anchor offset={72} items={[{ href: '#details', title: 'Details' }, { href: '#history', title: 'History' }]} />
 * ```
 */

export type AnchorItem = {
  href: string
  title: React.ReactNode
  children?: AnchorItem[]
}

export type AnchorProps = Omit<React.HTMLAttributes<HTMLElement>, 'onChange' | 'onClick'> & {
  items: AnchorItem[]
  offset?: number
  getContainer?: () => HTMLElement | Window
  onChange?: (href: string) => void
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>, item: AnchorItem) => void
  label?: string
}

export function flattenAnchorItems(items: AnchorItem[]): AnchorItem[] {
  return items.flatMap((item) => [item, ...flattenAnchorItems(item.children ?? [])])
}

function targetFor(href: string): HTMLElement | null {
  if (!href.startsWith('#') || href.length < 2) return null
  return document.getElementById(decodeURIComponent(href.slice(1)))
}

function scrolledToEnd(container: HTMLElement | Window): boolean {
  if (container === window) {
    const root = document.documentElement
    return root.scrollHeight > window.innerHeight && window.scrollY + window.innerHeight >= root.scrollHeight - 2
  }
  const element = container as HTMLElement
  return element.scrollHeight > element.clientHeight && element.scrollTop + element.clientHeight >= element.scrollHeight - 2
}

function containerTop(container: HTMLElement | Window): number {
  return container === window ? 0 : (container as HTMLElement).getBoundingClientRect().top
}

export function resolveActiveAnchor(positions: Array<{ href: string; top: number }>, threshold: number): string {
  let active = ''
  for (const position of positions) {
    if (position.top <= threshold) active = position.href
  }
  return active || positions[0]?.href || ''
}

export function Anchor({ items, offset = 0, getContainer, onChange, onClick, label, className, ...props }: AnchorProps) {
  const t = useT()
  const [active, setActive] = React.useState('')
  const activeRef = React.useRef('')
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const hrefs = flattenAnchorItems(items).map((item) => item.href)
  const hrefsKey = hrefs.join('|')

  React.useEffect(() => {
    const container = getContainer?.() ?? window
    let frame = 0
    const update = () => {
      frame = 0
      const top = containerTop(container)
      const positions = hrefsKey
        .split('|')
        .map((href) => ({ href, element: targetFor(href) }))
        .filter((entry): entry is { href: string; element: HTMLElement } => entry.element !== null)
        .map(({ href, element }) => ({ href, top: element.getBoundingClientRect().top - top }))
      const next = scrolledToEnd(container) && positions.length > 0 ? positions[positions.length - 1].href : resolveActiveAnchor(positions, offset + 1)
      if (!next || next === activeRef.current) return
      activeRef.current = next
      setActive(next)
      onChangeRef.current?.(next)
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }
    update()
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [hrefsKey, offset, getContainer])

  const handleClick = (item: AnchorItem) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event, item)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    const target = targetFor(item.href)
    if (!target) return
    event.preventDefault()
    const container = getContainer?.() ?? window
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'
    if (container === window) {
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior })
    } else {
      const element = container as HTMLElement
      element.scrollTo({ top: target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - offset, behavior })
    }
    window.history.replaceState(null, '', item.href)
    activeRef.current = item.href
    setActive(item.href)
    onChange?.(item.href)
  }

  const renderItems = (list: AnchorItem[], depth: number): React.ReactNode => (
    <ul className={cn('space-y-1', depth > 0 && 'mt-1')}>
      {list.map((item) => {
        const current = item.href === active
        return (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={current ? 'location' : undefined}
              data-slot="anchor-link"
              onClick={handleClick(item)}
              className={cn(
                '-ml-px block border-l py-1 text-sm transition-colors outline-none focus-visible:shadow-focus focus-visible:rounded-sm',
                depth === 0 ? 'pl-3' : 'pl-6',
                current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.title}
            </a>
            {item.children && item.children.length > 0 ? renderItems(item.children, depth + 1) : null}
          </li>
        )
      })}
    </ul>
  )

  return (
    <nav
      aria-label={label ?? t('ui.anchor.ariaLabel', 'On this page')}
      data-slot="anchor"
      className={cn('border-l border-border', className)}
      {...props}
    >
      {renderItems(items, 0)}
    </nav>
  )
}
