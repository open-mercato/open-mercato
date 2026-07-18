'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Production module landing page. Phase 1 replaces this overview with the
 * technology and orders surfaces; the scaffold ships it so the module has a
 * visible, toggle-gated entry point (task 0.2 DoD).
 */
export default function ProductionOverviewPage() {
  const t = useT()

  return (
    <div className="flex flex-col gap-3 p-6">
      <h1 className="text-lg font-semibold text-foreground">
        {t('production.overview.title', 'Production planning')}
      </h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t(
          'production.overview.description',
          'Plan and record manufacturing: technology (BOMs, routings, work centers), production orders, material requirements planning, and shop-floor reporting arrive in the upcoming phases of this module.',
        )}
      </p>
    </div>
  )
}
