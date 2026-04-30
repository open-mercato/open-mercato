import * as React from 'react'

export type NotificationCountBadgeProps = {
  count: number
}

export function NotificationCountBadge({ count }: NotificationCountBadgeProps) {
  if (count <= 0) return null
  return (
    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-overline font-medium text-destructive-foreground">
      {count > 99 ? '99+' : count}
    </span>
  )
}
