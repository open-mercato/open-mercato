import * as React from 'react'
import { FileText } from 'lucide-react'
import {
  StatusBadge,
  type StatusBadgeVariant,
} from '@open-mercato/ui/primitives/status-badge'

export type FinanceStatusIcon =
  | 'completed'
  | 'pending'
  | 'error'
  | 'info'
  | 'neutral'
  | 'draft'

const iconPaths = {
  completed: [
    'M8 14C4.6862 14 2 11.3138 2 8C2 4.6862 4.6862 2 8 2C11.3138 2 14 4.6862 14 8C14 11.3138 11.3138 14 8 14ZM7.4018 10.4L11.6438 6.1574L10.7954 5.309L7.4018 8.7032L5.7044 7.0058L4.856 7.8542L7.4018 10.4Z',
  ],
  error: [
    'M8 14C4.6862 14 2 11.3138 2 8C2 4.6862 4.6862 2 8 2C11.3138 2 14 4.6862 14 8C14 11.3138 11.3138 14 8 14ZM7.4 9.8V11H8.6V9.8H7.4ZM7.4 5V8.6H8.6V5H7.4Z',
  ],
  pending: [
    'M7.33333 4C7.33333 3.63181 7.63181 3.33333 8 3.33333C8.36819 3.33333 8.66667 3.63181 8.66667 4V7.33333H10.6667C11.0349 7.33333 11.3333 7.63181 11.3333 8C11.3333 8.36819 11.0349 8.66667 10.6667 8.66667H8C7.63181 8.66667 7.33333 8.36819 7.33333 8V4Z',
    'M14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8ZM15.3333 8C15.3333 12.0501 12.0501 15.3333 8 15.3333C3.94991 15.3333 0.666667 12.0501 0.666667 8C0.666667 3.94991 3.94991 0.666667 8 0.666667C12.0501 0.666667 15.3333 3.94991 15.3333 8Z',
  ],
  info: [
    'M8 14C4.6862 14 2 11.3138 2 8C2 4.6862 4.6862 2 8 2C11.3138 2 14 4.6862 14 8C14 11.3138 11.3138 14 8 14ZM7.4 7.4V11H8.6V7.4H7.4ZM7.4 5V6.2H8.6V5H7.4Z',
  ],
  neutral: [
    'M8 14C4.6862 14 2 11.3138 2 8C2 4.6862 4.6862 2 8 2C11.3138 2 14 4.6862 14 8C14 11.3138 11.3138 14 8 14ZM5.9138 5.0654C5.58604 5.29915 5.29952 5.58587 5.066 5.9138L10.0868 10.9346C10.4148 10.7009 10.7015 10.4142 10.9352 10.0862L5.9138 5.0654Z',
  ],
} as const

const iconColors: Record<StatusBadgeVariant, string> = {
  success: 'text-status-success-icon',
  warning: 'text-accent-indigo',
  error: 'text-status-error-icon',
  info: 'text-accent-indigo',
  neutral: 'text-status-neutral-icon',
}

const defaultIcons: Record<StatusBadgeVariant, FinanceStatusIcon> = {
  success: 'completed',
  warning: 'pending',
  error: 'error',
  info: 'info',
  neutral: 'neutral',
}

export function FinanceStatusBadge({
  children,
  variant = 'neutral',
  icon = defaultIcons[variant],
}: {
  children: React.ReactNode
  variant?: StatusBadgeVariant
  icon?: FinanceStatusIcon
}) {
  return (
    <StatusBadge
      variant={variant}
      appearance="stroke"
      className="h-6 shrink-0 gap-1 whitespace-nowrap rounded-sm py-0 pl-1 pr-2 text-xs font-medium leading-4 tracking-normal"
    >
      <span
        className={`flex size-4 shrink-0 items-center justify-center ${iconColors[variant]}`}
        aria-hidden="true"
      >
        {icon === 'draft' ? (
          <FileText className="size-4" />
        ) : (
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="currentColor"
            focusable="false"
          >
            {iconPaths[icon].map((path) => (
              <path key={path} d={path} />
            ))}
          </svg>
        )}
      </span>
      {children}
    </StatusBadge>
  )
}
