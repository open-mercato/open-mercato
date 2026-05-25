"use client"

import * as React from 'react'
import { Info, Save } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type DealFormFooterProps = {
  info: string
  cancelLabel: string
  submitLabel: string
  onCancel: () => void
  onSubmit: () => void
  isSubmitting?: boolean
  submitDisabled?: boolean
}

export function DealFormFooter({
  info,
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  isSubmitting,
  submitDisabled,
}: DealFormFooterProps) {
  return (
    <footer className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="size-4" />
        <span>{info}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button type="button" onClick={onSubmit} disabled={isSubmitting || submitDisabled}>
          {isSubmitting ? <Spinner className="size-4" /> : <Save className="size-4" />}
          {submitLabel}
        </Button>
      </div>
    </footer>
  )
}
