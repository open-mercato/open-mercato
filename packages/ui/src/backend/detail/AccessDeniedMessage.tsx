"use client"

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { InjectionSpot } from '../injection/InjectionSpot'
import { BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID } from '../injection/spotIds'

export type AccessDeniedInjectionContext = {
  path: string | null
  requiredFeatures: string[]
}

type AccessDeniedMessageProps = {
  label: string
  description?: string
  action?: React.ReactNode
  className?: string
  iconClassName?: string
  path?: string | null
  requiredFeatures?: readonly string[] | null
}

export function AccessDeniedMessage({
  label,
  description,
  action,
  className,
  iconClassName,
  path,
  requiredFeatures,
}: AccessDeniedMessageProps) {
  const hasAccessContext = path !== undefined || requiredFeatures !== undefined
  const normalizedPath = typeof path === 'string' && path.length > 0 ? path : null
  const featureKey = Array.isArray(requiredFeatures) ? requiredFeatures.join('\u0000') : ''
  const injectionContext = React.useMemo<AccessDeniedInjectionContext>(
    () => ({
      path: normalizedPath,
      requiredFeatures: featureKey ? featureKey.split('\u0000') : [],
    }),
    [normalizedPath, featureKey],
  )
  const message = (
    <div
      className={cn(
        'flex items-start gap-3 rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text',
        className
      )}
      role="alert"
    >
      <ShieldAlert className={cn('h-4 w-4 flex-none', iconClassName)} aria-hidden />
      <div className="space-y-1">
        <p className="leading-tight">{label}</p>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
  if (!hasAccessContext) return message
  return (
    <div className="space-y-3">
      {message}
      <InjectionSpot spotId={BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID} context={injectionContext} />
    </div>
  )
}
