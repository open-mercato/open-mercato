"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

const SidebarContext = React.createContext(false)

export type SidebarProps = React.HTMLAttributes<HTMLElement> & { collapsed?: boolean }

export function Sidebar({ collapsed = false, className, children, ...props }: SidebarProps) {
  return <SidebarContext.Provider value={collapsed}>
    <aside data-slot="sidebar" data-collapsed={collapsed} className={cn('flex shrink-0 flex-col bg-background text-foreground', collapsed ? 'w-20' : 'w-68', className)} {...props}>{children}</aside>
  </SidebarContext.Provider>
}

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const collapsed = React.useContext(SidebarContext)
  return <div data-slot="sidebar-header" className={cn('flex h-22 shrink-0 items-center justify-center', collapsed ? 'px-2 py-3' : 'p-3', className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const collapsed = React.useContext(SidebarContext)
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-5 px-5 pt-5 pb-4', collapsed && 'items-center', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const collapsed = React.useContext(SidebarContext)
  return <div data-slot="sidebar-footer" className={cn('flex h-22 shrink-0 items-center justify-center', collapsed ? 'px-2 py-3' : 'p-3', className)} {...props} />
}

export type SidebarItemProps = Omit<React.ComponentProps<typeof Button>, 'size' | 'variant' | 'children' | 'asChild'> & {
  children: React.ReactNode
  icon: React.ReactNode
  trailing?: React.ReactNode
  collapsed?: boolean
  active?: boolean
}

export function SidebarItem({ children, icon, trailing, collapsed: collapsedProp, active = false, className, ...props }: SidebarItemProps) {
  const inheritedCollapsed = React.useContext(SidebarContext)
  const collapsed = collapsedProp ?? inheritedCollapsed
  return <Button type="button" variant="ghost" data-slot="sidebar-item" data-collapsed={collapsed} aria-current={active ? 'page' : undefined}
    className={cn('relative h-9 shrink-0 justify-start gap-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-muted-foreground',
      collapsed ? 'mx-auto size-9 p-2' : 'w-full px-3 py-2',
      active && 'bg-muted text-foreground hover:text-foreground',
      className)} {...props}>
    <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5" aria-hidden="true">{icon}</span>
    <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate text-left'}>{children}</span>
    {!collapsed && trailing ? <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">{trailing}</span> : null}
  </Button>
}

export type SidebarIdentityProps = Omit<React.ComponentProps<typeof Button>, 'size' | 'variant' | 'children' | 'asChild'> & {
  label: string
  description?: string
  leading: React.ReactNode
  trailing?: React.ReactNode
  badge?: React.ReactNode
  collapsed?: boolean
}

export function SidebarIdentity({ label, description, leading, trailing, badge, collapsed: collapsedProp, className, ...props }: SidebarIdentityProps) {
  const inheritedCollapsed = React.useContext(SidebarContext)
  const collapsed = collapsedProp ?? inheritedCollapsed
  return <Button type="button" variant="ghost" data-slot="sidebar-identity" data-collapsed={collapsed} className={cn('h-16 gap-3 rounded-lg p-3 text-left hover:bg-muted data-[state=open]:bg-muted', collapsed ? 'w-16' : 'w-full justify-start', className)} {...props}>
    <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden="true">{leading}</span>
    <span className={collapsed ? 'sr-only' : 'flex min-w-0 flex-1 flex-col gap-1'}>
      <span className="flex items-center gap-1 text-sm font-medium leading-5"><span className="truncate">{label}</span>{badge}</span>
      {description ? <span className="truncate text-xs font-normal leading-4 text-muted-foreground">{description}</span> : null}
    </span>
    {!collapsed && trailing ? <span className="shrink-0" aria-hidden="true">{trailing}</span> : null}
  </Button>
}

export type SidebarFeatureCardProps = React.HTMLAttributes<HTMLDivElement> & {
  appearance?: 'stroke' | 'gray' | 'primary' | 'neutral'
}

export function SidebarFeatureCard({ appearance = 'stroke', className, ...props }: SidebarFeatureCardProps) {
  return <div data-slot="sidebar-feature-card" data-appearance={appearance} className={cn('relative w-58 max-w-full rounded-lg p-4', {
    stroke: 'bg-background text-foreground ring-1 ring-inset ring-border',
    gray: 'bg-muted text-foreground',
    primary: 'bg-status-info-solid text-status-info-solid-foreground',
    neutral: 'bg-primary text-primary-foreground',
  }[appearance], className)} {...props} />
}

export function Topbar({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header data-slot="topbar" className={cn('flex min-h-20 w-full flex-wrap items-center gap-4 bg-background px-11 py-5 text-foreground', className)} {...props} />
}
