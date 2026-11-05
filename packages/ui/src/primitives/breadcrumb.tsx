'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

export type BreadcrumbDivider = 'slash' | 'arrow' | 'dot'

type BreadcrumbContextValue = {
  divider: BreadcrumbDivider
}

const BreadcrumbContext = React.createContext<BreadcrumbContextValue>({
  divider: 'slash',
})

export type BreadcrumbProps = React.ComponentProps<'nav'> & {
  divider?: BreadcrumbDivider
}

export function Breadcrumb({
  divider = 'slash',
  className,
  children,
  ...props
}: BreadcrumbProps) {
  const contextValue = React.useMemo<BreadcrumbContextValue>(
    () => ({ divider }),
    [divider],
  )
  return (
    <BreadcrumbContext.Provider value={contextValue}>
      <nav
        aria-label="Breadcrumb"
        data-slot="breadcrumb"
        data-divider={divider}
        className={cn('min-w-0', className)}
        {...props}
      >
        {children}
      </nav>
    </BreadcrumbContext.Provider>
  )
}

export type BreadcrumbListProps = React.ComponentProps<'ol'>

export function BreadcrumbList({ className, children, ...props }: BreadcrumbListProps) {
  if (React.Children.count(children) === 0) return null
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'flex items-center gap-1.5 text-sm font-medium leading-5 tracking-tight min-w-0',
        className,
      )}
      {...props}
    >
      {children}
    </ol>
  )
}

export type BreadcrumbItemProps = React.ComponentProps<'li'>

export function BreadcrumbItem({ className, ...props }: BreadcrumbItemProps) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex items-center gap-1.5 min-w-0', className)}
      {...props}
    />
  )
}

export type BreadcrumbLinkProps = React.ComponentProps<'a'> & {
  asChild?: boolean
}

export function BreadcrumbLink({
  asChild = false,
  className,
  children,
  ...props
}: BreadcrumbLinkProps) {
  const Comp = asChild ? Slot : 'a'
  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn(
        "inline-flex items-center gap-1.5 max-w-[40vw] md:max-w-[28vw] truncate text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground rounded-sm focus-visible:shadow-focus [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}

export type BreadcrumbPageProps = React.ComponentProps<'span'>

export function BreadcrumbPage({ className, ...props }: BreadcrumbPageProps) {
  return (
    <span
      aria-current="page"
      data-slot="breadcrumb-page"
      className={cn(
        "inline-block text-foreground truncate min-w-0 max-w-[45vw] md:max-w-[60vw] [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0 [&_svg]:inline-block [&_svg]:align-middle",
        className,
      )}
      {...props}
    />
  )
}

export type BreadcrumbStaticProps = React.ComponentProps<'span'>

export function BreadcrumbStatic({ className, ...props }: BreadcrumbStaticProps) {
  return (
    <span
      data-slot="breadcrumb-static"
      className={cn(
        "inline-flex items-center gap-1.5 max-w-[40vw] md:max-w-[28vw] truncate text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

export type BreadcrumbSeparatorProps = React.ComponentProps<'li'> & {
  divider?: BreadcrumbDivider
}

export function BreadcrumbSeparator({
  divider: dividerProp,
  className,
  children,
  ...props
}: BreadcrumbSeparatorProps) {
  const { divider: contextDivider } = React.useContext(BreadcrumbContext)
  const divider = dividerProp ?? contextDivider
  return (
    <li
      role="presentation"
      aria-hidden="true"
      data-slot="breadcrumb-separator"
      data-divider={divider}
      className={cn(
        "inline-flex items-center text-text-disabled select-none [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    >
      {children ?? <DefaultSeparator divider={divider} />}
    </li>
  )
}

function DefaultSeparator({ divider }: { divider: BreadcrumbDivider }) {
  if (divider === 'arrow') return <ChevronRight aria-hidden="true" />
  if (divider === 'dot') return <span aria-hidden="true">·</span>
  return <span aria-hidden="true">/</span>
}

export type BreadcrumbEllipsisProps = React.ComponentProps<'span'>

export function BreadcrumbEllipsis({ className, children, ...props }: BreadcrumbEllipsisProps) {
  return (
    <span
      role="presentation"
      data-slot="breadcrumb-ellipsis"
      className={cn(
        'inline-flex size-5 items-center justify-center text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children ?? <MoreHorizontal aria-hidden="true" className="size-4" />}
      <span className="sr-only">More</span>
    </span>
  )
}
