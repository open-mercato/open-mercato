"use client"

import * as React from 'react'
import { useFeatureFlag } from './hooks/useFeatureFlag'

export type FeatureGuardProps = {
  id: string
  children: React.ReactNode
  fallback?: React.ReactNode
  loadingFallback?: React.ReactNode
}

/**
 * FeatureGuard component that conditionally renders children based on feature toggle state.
 * 
 * @param id - The feature toggle identifier
 * @param children - Content to render when the feature is enabled
 * @param fallback - Optional content to render when the feature is disabled
 * @param loadingFallback - Optional content to render while loading the feature state
 */
export function FeatureGuard({
  id,
  children,
  fallback = null,
  loadingFallback = null,
}: FeatureGuardProps) {
  const { enabled, isLoading } = useFeatureFlag({ id })

  if (isLoading) {
    return <>{loadingFallback}</>
  }

  if (!enabled) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
