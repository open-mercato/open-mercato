'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'

export type MobilePersonZone = 'details' | 'activity'

export type MobilePersonDetailProps = {
  zone1: React.ReactNode
  zone2: React.ReactNode
  defaultZone?: MobilePersonZone
  /**
   * Controls whether zone state is synced to the URL `?zone=` query param.
   * Defaults to true on the page route so deep links round-trip.
   */
  syncToUrl?: boolean
}

const ZONES: Array<{ id: MobilePersonZone; labelKey: string; fallback: string }> = [
  { id: 'details', labelKey: 'customers.people.mobile.zoneSwitcher.details', fallback: 'Details' },
  { id: 'activity', labelKey: 'customers.people.mobile.zoneSwitcher.activity', fallback: 'Activity' },
]

export function MobilePersonDetail({
  zone1,
  zone2,
  defaultZone = 'details',
  syncToUrl = true,
}: MobilePersonDetailProps) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialZone = React.useMemo<MobilePersonZone>(() => {
    if (!syncToUrl) return defaultZone
    const raw = searchParams?.get('zone')
    if (raw === 'activity' || raw === 'details') return raw
    return defaultZone
    // Intentionally compute only from the initial searchParams snapshot; external URL updates
    // (browser back, manual edit) are acceptable to be out of sync on mobile — local clicks
    // own the zone state thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [zone, setZone] = React.useState<MobilePersonZone>(initialZone)
  const lastWrittenZoneRef = React.useRef<MobilePersonZone | null>(null)

  const handleZoneChange = React.useCallback(
    (next: MobilePersonZone) => {
      setZone(next)
      lastWrittenZoneRef.current = next
      if (!syncToUrl) return
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next === defaultZone) {
        params.delete('zone')
      } else {
        params.set('zone', next)
      }
      const query = params.toString()
      router.replace(query.length ? `?${query}` : '?', { scroll: false })
    },
    [defaultZone, router, searchParams, syncToUrl],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const currentIndex = ZONES.findIndex((entry) => entry.id === zone)
      if (currentIndex < 0) return
      const offset = event.key === 'ArrowRight' ? 1 : -1
      const nextIndex = (currentIndex + offset + ZONES.length) % ZONES.length
      handleZoneChange(ZONES[nextIndex].id)
    },
    [handleZoneChange, zone],
  )

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t(
          'customers.people.mobile.zoneSwitcher.ariaLabel',
          'Zone selector',
        )}
        className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/20 p-1"
        onKeyDown={handleKeyDown}
      >
        {ZONES.map((entry) => {
          const isActive = zone === entry.id
          return (
            <Button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`mobile-person-zone-${entry.id}`}
              variant={isActive ? 'default' : 'ghost'}
              className={cn(
                'h-11 rounded-lg text-sm font-semibold',
                isActive ? '' : 'text-muted-foreground',
              )}
              onClick={() => handleZoneChange(entry.id)}
            >
              {t(entry.labelKey, entry.fallback)}
            </Button>
          )
        })}
      </div>
      <div
        id={`mobile-person-zone-${zone}`}
        role="tabpanel"
        aria-labelledby={`mobile-person-zone-${zone}-tab`}
      >
        {zone === 'details' ? zone1 : zone2}
      </div>
    </div>
  )
}

export default MobilePersonDetail
