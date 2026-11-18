"use client"

import * as React from 'react'
import Link from 'next/link'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'

export const LINK_TARGET_FEATURES = {
  person: 'customers.people.view',
  company: 'customers.companies.view',
  product: 'catalog.products.view',
  salesOrder: 'sales.orders.view',
  salesChannels: 'sales.channels.manage',
  salesSettings: 'sales.settings.manage',
  settings: 'property_management.manage',
} as const

export type LinkTarget = keyof typeof LINK_TARGET_FEATURES

export function useCanOpenLink(target: LinkTarget): boolean {
  const { payload } = useBackendChrome()
  return hasFeature(payload?.grantedFeatures, LINK_TARGET_FEATURES[target])
}

export type GatedLinkProps = {
  target: LinkTarget
  href: string
  className?: string
  testId?: string
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  children: React.ReactNode
}

export function GatedLink({ target, href, className, testId, onClick, children }: GatedLinkProps) {
  const allowed = useCanOpenLink(target)
  if (!allowed) return <span className={className} data-testid={testId}>{children}</span>
  const linkClassName = className ? `${className} hover:underline` : 'hover:underline'
  return <Link href={href} className={linkClassName} data-testid={testId} onClick={onClick}>{children}</Link>
}
