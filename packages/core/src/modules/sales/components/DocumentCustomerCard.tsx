"use client"

import * as React from 'react'
import { Building2, Mail, MousePointerClick, Pencil, Users } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'

type DocumentCustomerCardProps = {
  label?: string
  name?: string | null
  email?: string | null
  kind?: 'company' | 'person'
  onEditSnapshot?: () => void
  onSelectCustomer?: () => void
  className?: string
}

export function DocumentCustomerCard({
  label,
  name,
  email,
  kind = 'company',
  onEditSnapshot,
  onSelectCustomer,
  className,
}: DocumentCustomerCardProps) {
  const Icon = kind === 'person' ? Users : Building2
  const interactiveProps = onSelectCustomer
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onSelectCustomer,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectCustomer()
          }
        },
      }
    : {}
  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-3',
        onSelectCustomer ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : null,
        className,
      )}
      {...interactiveProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          {label ? (
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {label}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Icon aria-hidden className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-0.5">
              {name ? (
                <p className="text-sm font-medium leading-tight text-foreground">{name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No customer assigned</p>
              )}
              {email ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  <span>{email}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              if (onEditSnapshot) onEditSnapshot()
            }}
            className={cn(
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100',
              !onEditSnapshot ? 'cursor-default opacity-0' : null,
            )}
            disabled={!onEditSnapshot}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="sr-only">Edit customer snapshot</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation()
              if (onSelectCustomer) onSelectCustomer()
            }}
            className={cn(
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100',
              !onSelectCustomer ? 'cursor-default opacity-0' : null,
            )}
            disabled={!onSelectCustomer}
          >
            <MousePointerClick className="h-4 w-4" aria-hidden />
            <span className="sr-only">Select customer</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
