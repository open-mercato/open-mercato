'use client'

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { FloatingPosition } from '../../types'

export interface AiDotProps {
  onClick: () => void
  isActive?: boolean
  hasMessages?: boolean
  position: FloatingPosition
  className?: string
}

const floatingPositionStyles: Record<FloatingPosition, React.CSSProperties> = {
  'bottom-right': { bottom: 24, right: 24 },
  'bottom-left': { bottom: 24, left: 24 },
  'top-right': { top: 24, right: 24 },
  'top-left': { top: 24, left: 24 },
}

export function AiDot({ onClick, isActive, hasMessages, position, className }: AiDotProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed z-50 group',
        'w-14 h-14 rounded-full',
        'flex items-center justify-center',
        'cursor-pointer',
        'transition-transform duration-200 ease-out',
        'hover:scale-110 active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      style={floatingPositionStyles[position]}
      aria-label="Open AI Assistant"
    >
      {/* Outer glow effect */}
      <div
        className={cn(
          'absolute inset-0 rounded-full',
          'bg-gradient-to-r from-violet-500/30 via-fuchsia-500/30 to-cyan-500/30',
          'blur-xl',
          isActive ? 'animate-ai-glow-active' : 'animate-ai-glow'
        )}
      />

      {/* Main gradient orb */}
      <div
        className={cn(
          'relative w-12 h-12 rounded-full',
          'bg-gradient-to-br from-violet-600 via-fuchsia-500 to-cyan-400',
          'shadow-lg shadow-violet-500/25',
          isActive ? 'animate-ai-pulse-active' : 'animate-ai-pulse'
        )}
      >
        {/* Inner highlight */}
        <div className="absolute inset-1 rounded-full bg-gradient-to-br from-white/20 to-transparent" />

        {/* Animated gradient overlay */}
        <div
          className={cn(
            'absolute inset-0 rounded-full',
            'bg-gradient-conic from-violet-600 via-fuchsia-500 via-cyan-400 to-violet-600',
            'opacity-60',
            'animate-ai-spin'
          )}
          style={{ mixBlendMode: 'overlay' }}
        />

        {/* Center sparkle icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="text-white drop-shadow-sm"
          >
            <path
              d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"
              fill="currentColor"
              className={cn(
                'origin-center',
                isActive ? 'animate-ai-sparkle-active' : 'animate-ai-sparkle'
              )}
            />
          </svg>
        </div>
      </div>

      {/* Message indicator badge */}
      {hasMessages && (
        <div
          className={cn(
            'absolute top-1 right-1',
            'w-3 h-3 rounded-full',
            'bg-emerald-500 border-2 border-white',
            'shadow-sm',
            'animate-pulse'
          )}
        />
      )}
    </button>
  )
}

export default AiDot
