"use client"

import * as React from 'react'
import { InjectionSpot } from './InjectionSpot'

function normalizePath(path: string): string {
  const trimmed = path.replace(/\?.*$/, '').replace(/\/+$/, '')
  const withoutLeading = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const safe = withoutLeading.length ? withoutLeading : 'root'
  return safe.replace(/[^a-zA-Z0-9]+/g, ':')
}

export function PageInjectionBoundary({
  path,
  context,
  children,
}: {
  path: string
  context?: Record<string, unknown>
  children: React.ReactNode
}) {
  const handle = React.useMemo(() => normalizePath(path || '/'), [path])
  const beforeSpotId = React.useMemo(() => `admin.page:${handle}:before`, [handle])
  const afterSpotId = React.useMemo(() => `admin.page:${handle}:after`, [handle])

  return (
    <>
      <InjectionSpot spotId={beforeSpotId} context={context ?? { path }} />
      {children}
      <InjectionSpot spotId={afterSpotId} context={context ?? { path }} />
    </>
  )
}
