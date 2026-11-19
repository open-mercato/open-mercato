import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../lib/cn'
import { ChevronLeftIcon } from '../lib/icons'

export type BreadcrumbItem = {
  label: React.ReactNode
  href?: string
}

export type BreadcrumbsProps = Omit<React.ComponentPropsWithoutRef<'nav'>, 'children'> & {
  /** Ordered trail; the last item is the current page. */
  items: BreadcrumbItem[]
  /** Accessible name of the landmark, resolved by the app's i18n. */
  label: string
  /** Under `sm` only the parent link is shown, prefixed with a back chevron and this label. */
  backLabel?: string
  /** Render links through the app's router Link via `asChild` semantics. */
  linkComponent?: React.ElementType
  /** Set to false when the page title sits right below and would repeat the last item; only the parents are shown. */
  showCurrent?: boolean
  /** `inverse` for a trail placed on a primary-coloured surface, such as a category header. */
  tone?: 'default' | 'inverse'
}

export const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(function Breadcrumbs(
  { items, label, backLabel, linkComponent, showCurrent = true, tone = 'default', className, ...props },
  ref,
) {
  const Link = linkComponent ?? 'a'
  const parent = items.length > 1 ? items[items.length - 2] : undefined
  const inverse = tone === 'inverse'
  const strong = inverse ? 'text-primary-foreground' : 'text-foreground'
  return (
    <nav ref={ref} aria-label={label} data-slot="breadcrumbs" className={cn('text-sf-body-xs', inverse ? 'text-primary-foreground/80' : 'text-muted-foreground', className)} {...props}>
      <ol className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', backLabel && parent ? 'hidden sm:flex' : undefined)}>
        {(showCurrent ? items : items.slice(0, -1)).map((item, index) => {
          const current = showCurrent && index === items.length - 1
          return (
            <li key={index} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="select-none">/</span> : null}
              {current || !item.href ? (
                <span aria-current={current ? 'page' : undefined} className={cn(current && strong)}>{item.label}</span>
              ) : (
                <Slot>
                  <Link href={item.href} className={cn('rounded-sm underline-offset-4 outline-none hover:underline focus-visible:shadow-focus', inverse ? 'hover:text-primary-foreground' : 'hover:text-foreground')}>
                    {item.label}
                  </Link>
                </Slot>
              )}
            </li>
          )
        })}
      </ol>
      {backLabel && parent?.href ? (
        <Link href={parent.href} className={cn('inline-flex items-center gap-1 rounded-sm text-sf-body-sm outline-none focus-visible:shadow-focus sm:hidden [&_svg]:size-4', strong)}>
          <ChevronLeftIcon />
          <span className="sr-only">{backLabel} </span>
          {parent.label}
        </Link>
      ) : null}
    </nav>
  )
})
