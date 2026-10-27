'use client'

import * as React from 'react'

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server, so client components
 * that also render on the server do not emit React's useLayoutEffect SSR warning.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect
