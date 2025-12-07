import * as React from 'react'
import { Spinner } from './spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface DataLoaderProps {
  isLoading: boolean
  children: React.ReactNode
  loadingMessage?: string
  spinnerSize?: 'sm' | 'md' | 'lg'
  className?: string
  loadingClassName?: string
  // Optional: show a skeleton or placeholder instead of just spinner
  showSkeleton?: boolean
  skeletonComponent?: React.ReactNode
}

export function DataLoader({
  isLoading,
  children,
  loadingMessage,
  spinnerSize = 'md',
  className = '',
  loadingClassName = '',
  showSkeleton = false,
  skeletonComponent
}: DataLoaderProps) {
  const t = useT()
  const resolvedLoadingMessage = loadingMessage ?? t('ui.dataLoader.loading', 'Loading...')
  if (isLoading) {
    if (showSkeleton && skeletonComponent) {
      return <div className={className}>{skeletonComponent}</div>
    }

    return (
      <div className={`flex items-center justify-center gap-2 py-4 ${loadingClassName} ${className}`}>
        <Spinner size={spinnerSize} />
        <span className="text-sm text-muted-foreground">{resolvedLoadingMessage}</span>
      </div>
    )
  }

  return <div className={className}>{children}</div>
}

// Convenience component for inline loading states
export function InlineLoader({
  isLoading,
  children,
  loadingMessage,
  spinnerSize = 'sm'
}: {
  isLoading: boolean
  children: React.ReactNode
  loadingMessage?: string
  spinnerSize?: 'sm' | 'md' | 'lg'
}) {
  return (
    <DataLoader
      isLoading={isLoading}
      loadingMessage={loadingMessage}
      spinnerSize={spinnerSize}
      className="inline-flex items-center"
      loadingClassName="py-2"
    >
      {children}
    </DataLoader>
  )
}

// Convenience component for full-page loading states
export function PageLoader({
  isLoading,
  children,
  loadingMessage,
  spinnerSize = 'lg'
}: {
  isLoading: boolean
  children: React.ReactNode
  loadingMessage?: string
  spinnerSize?: 'sm' | 'md' | 'lg'
}) {
  return (
    <DataLoader
      isLoading={isLoading}
      loadingMessage={loadingMessage}
      spinnerSize={spinnerSize}
      className="min-h-[200px] flex items-center justify-center"
    >
      {children}
    </DataLoader>
  )
}
