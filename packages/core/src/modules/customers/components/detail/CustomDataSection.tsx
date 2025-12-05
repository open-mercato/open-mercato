"use client"

import * as React from 'react'
import {
  CustomDataSection as SharedCustomDataSection,
  type CustomDataLabels,
  type CustomDataSectionProps as SharedCustomDataSectionProps,
} from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type CustomDataSectionProps = Omit<SharedCustomDataSectionProps, 'labels' | 'scopeVersion' | 'loadFields'> & {
  definitionHref?: string
}

export function CustomDataSection(props: CustomDataSectionProps) {
  const t = useT()
  const labels = React.useMemo<CustomDataLabels>(
    () => ({
      loading: t('customers.people.detail.loading'),
      emptyValue: t('customers.people.detail.noValue'),
      noFields: t('entities.customFields.empty'),
      defineFields: t('customers.people.detail.customFields.defineFirst'),
      saveShortcut: t('customers.people.detail.inline.saveShortcut'),
      edit: t('ui.forms.actions.edit'),
      cancel: t('ui.forms.actions.cancel'),
    }),
    [t],
  )

  return (
    <SharedCustomDataSection
      {...props}
      labels={labels}
    />
  )
}

export default CustomDataSection
