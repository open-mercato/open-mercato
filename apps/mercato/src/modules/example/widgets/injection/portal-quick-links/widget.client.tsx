"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'

const LINKS = [
  { label: 'example.portal.dashboard.quickLinks.orders.label', description: 'example.portal.dashboard.quickLinks.orders.description', href: '#', icon: 'O' },
  { label: 'example.portal.dashboard.quickLinks.invoices.label', description: 'example.portal.dashboard.quickLinks.invoices.description', href: '#', icon: 'I' },
  { label: 'example.portal.dashboard.quickLinks.addresses.label', description: 'example.portal.dashboard.quickLinks.addresses.description', href: '#', icon: 'A' },
  { label: 'example.portal.dashboard.quickLinks.support.label', description: 'example.portal.dashboard.quickLinks.support.description', href: '#', icon: 'S' },
]

export default function PortalQuickLinksWidget() {
  const t = useT()

  return (
    <div className="grid grid-cols-2 gap-2">
      {LINKS.map((link) => (
        <a
          key={link.label}
          href={link.href}
          className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-bold text-background">
            {link.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(link.label)}</p>
            <p className="text-overline text-muted-foreground">{t(link.description)}</p>
          </div>
        </a>
      ))}
    </div>
  )
}
