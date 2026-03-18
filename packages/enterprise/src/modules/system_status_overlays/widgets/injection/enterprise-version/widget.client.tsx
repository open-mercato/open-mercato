"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { APP_VERSION } from '@open-mercato/shared/lib/version'

type AdminPageContext = {
  path?: string
}

export default function EnterpriseVersionWidget(
  _props: InjectionWidgetComponentProps<AdminPageContext, Record<string, unknown>>,
) {
  const t = useT()

  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            {t('system_status_overlays.enterpriseInfo.title', 'Edition and version')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              'system_status_overlays.enterpriseInfo.description',
              'This environment is running the Enterprise edition.',
            )}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          {t('system_status_overlays.enterpriseInfo.editionBadge', 'Enterprise')}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('system_status_overlays.enterpriseInfo.editionLabel', 'Edition')}
          </dt>
          <dd className="text-sm font-medium">
            {t('system_status_overlays.enterpriseInfo.editionValue', 'Enterprise')}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('system_status_overlays.enterpriseInfo.versionLabel', 'Version')}
          </dt>
          <dd className="text-sm font-medium font-mono">{APP_VERSION}</dd>
        </div>
      </dl>
    </section>
  )
}

