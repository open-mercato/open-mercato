import * as React from 'react'

export type NotificationCountBadgeProps = {
  count: number
}

export function NotificationCountBadge({ count }: NotificationCountBadgeProps) {
  if (count <= 0) return null
  return (
    <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-indigo px-1 text-overline font-medium text-accent-indigo-foreground ring-2 ring-background">
      {count > 99 ? '99+' : count}
    </span>
  )
}
