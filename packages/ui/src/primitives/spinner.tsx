"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function Spinner({ className = '', size = 'md' }: SpinnerProps) {
  const t = useT()
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  }

  return (
    <span
      className={`inline-flex items-center justify-center animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={t('ui.spinner.ariaLabel', 'Loading')}
    >
      <span className="sr-only">{t('ui.spinner.srOnly', 'Loading...')}</span>
    </span>
  )
}
