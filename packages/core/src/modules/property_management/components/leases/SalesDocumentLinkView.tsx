"use client"

import * as React from 'react'
import Link from 'next/link'
import type { SalesDocumentLink } from './leaseModel'

type SalesDocumentLinkViewProps = {
  link: SalesDocumentLink
  hiddenLabel: string
  emptyLabel?: React.ReactNode
  testId?: string
}

export function SalesDocumentLinkView({ link, hiddenLabel, emptyLabel = '—', testId }: SalesDocumentLinkViewProps) {
  if (link.state === 'link') return <Link href={link.href} className="hover:underline" data-testid={testId}>{link.label}</Link>
  if (link.state === 'hidden') return <span className="text-muted-foreground" data-testid={testId ? `${testId}-hidden` : undefined}>{hiddenLabel}</span>
  return <>{emptyLabel}</>
}

export default SalesDocumentLinkView
