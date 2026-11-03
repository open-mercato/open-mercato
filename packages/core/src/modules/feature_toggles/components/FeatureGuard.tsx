"use client"

import * as React from 'react'
import { useFeatureFlagBoolean } from './hooks/useFeatureFlagBoolean'

export type FeatureGuardProps = {
  id: string
  children: React.ReactNode
  fallback?: React.ReactNode
  loadingFallback?: React.ReactNode
  defaultValue?: boolean
}

/**
 * FeatureGuard component that conditionally renders children based on feature toggle state.
 *
 * @param id - The feature toggle identifier
 * @param children - Content to render when the feature is enabled
 * @param fallback - Optional content to render when the feature is disabled
 * @param loadingFallback - Optional content to render while loading the feature state
 * @param defaultValue - Toggle value assumed when the check cannot be resolved
 *   (undefined toggle, type mismatch, network or permission failure). Defaults
 *   to `false`; pass `true` to keep guarded UI visible when the check fails.
 *   Distinct from `fallback`, which is what gets rendered once the feature is
 *   known to be disabled.
 */
export function FeatureGuard({
  id,
  children,
  fallback = null,
  loadingFallback = null,
  defaultValue = false,
}: FeatureGuardProps) {
  const { enabled, isLoading } = useFeatureFlagBoolean({ id, defaultValue })

  if (isLoading) {
    return <>{loadingFallback}</>
  }

  if (!enabled) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
