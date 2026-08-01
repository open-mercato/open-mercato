'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

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
      <div onKeyDown={handleKeyDown}>
        <Tabs
          value={zone}
          onValueChange={(value) => handleZoneChange(value as MobilePersonZone)}
          variant="underline"
        >
          <TabsList
            aria-label={t(
              'customers.people.mobile.zoneSwitcher.ariaLabel',
              'Zone selector',
            )}
            className="w-full"
          >
            {ZONES.map((entry) => (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="flex-1 justify-center"
              >
                {t(entry.labelKey, entry.fallback)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
