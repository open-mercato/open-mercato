"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'

export type DealFormHeaderProps = {
  breadcrumb: Array<{ label: string; href?: string }>
  backHref: string
  backLabel: string
  title: string
  subtitle?: string
  cancelLabel: string
  submitLabel: string
  onCancel: () => void
  onSubmit: () => void
  isSubmitting?: boolean
  submitDisabled?: boolean
}

export function DealFormHeader({
  breadcrumb,
  backHref,
  backLabel,
  title,
  subtitle,
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  isSubmitting,
  submitDisabled,
}: DealFormHeaderProps) {
  const lastIndex = breadcrumb.length - 1
  return (
    <header className="sticky top-0 z-sticky bg-background pt-2 pb-4">
      <Breadcrumb divider="slash" className="mb-3">
        <BreadcrumbList>
          {breadcrumb.map((item, index) => {
            const isLast = index === lastIndex
            return (
              <React.Fragment key={`${item.label}-${index}`}>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  ) : item.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbLink>{item.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {isLast ? null : <BreadcrumbSeparator />}
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <IconButton asChild variant="outline" size="lg">
            <Link href={backHref} aria-label={backLabel}>
              <ArrowLeft className="size-4" />
            </Link>
          </IconButton>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
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
      </div>
    </header>
  )
}
