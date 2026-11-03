"use client"

import * as React from 'react'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { cn } from '@open-mercato/shared/lib/utils'

export type DealSectionCardProps = {
  title?: string
  children: React.ReactNode
  className?: string
}

/**
 * Section card for the create-deal page, the same card `CrudForm` draws around its field
 * groups on the person and company create pages, so the deal entry point lines up with
 * the rest of the CRM forms.
 */
export function DealSectionCard({ title, children, className }: DealSectionCardProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-6 space-y-5', className)}>
      {title ? <SectionHeader title={title} /> : null}
      {children}
    </section>
  )
}

export default DealSectionCard
