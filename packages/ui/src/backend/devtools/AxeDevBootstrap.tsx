'use client'

import * as React from 'react'

export function AxeDevBootstrap() {
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return

    let cancelled = false

    void Promise.all([
      import('@axe-core/react'),
      import('react'),
      import('react-dom'),
    ]).then(([axe, ReactModule, ReactDomModule]) => {
      if (cancelled) return
      axe.default(ReactModule, ReactDomModule, 1000)
    }).catch(() => {
      // @axe-core/react may be unavailable in some environments — safe to ignore
    })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
