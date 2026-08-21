"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormValues = {
  userId: string
  deviceId: string
  platform: 'ios' | 'android' | 'web'
  clientAppVersion: string
  osVersion: string
  pushToken: string
  pushProvider: string
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export default function DeviceAdminCreatePage() {
  const router = useRouter()
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'userId', label: t('devices.form.userId'), type: 'text', required: true, description: t('devices.form.userIdHint') },
    { id: 'deviceId', label: t('devices.form.deviceId'), type: 'text', required: true },
    {
      id: 'platform',
      label: t('devices.form.platform'),
      type: 'select',
      required: true,
      options: [
        { value: 'ios', label: 'iOS' },
        { value: 'android', label: 'Android' },
        { value: 'web', label: 'Web' },
      ],
    },
    { id: 'clientAppVersion', label: t('devices.form.appVersion'), type: 'text' },
    { id: 'osVersion', label: t('devices.form.osVersion'), type: 'text' },
    { id: 'pushToken', label: t('devices.form.pushToken'), type: 'password', description: t('devices.form.pushTokenHint') },
    { id: 'pushProvider', label: t('devices.form.pushProvider'), type: 'text' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    { id: 'details', title: t('devices.form.details'), column: 1, fields: ['userId', 'deviceId', 'platform', 'clientAppVersion', 'osVersion', 'pushToken', 'pushProvider'] },
  ]), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('devices.form.createTitle')}
          backHref="/backend/devices"
          fields={fields}
          groups={groups}
          initialValues={{ userId: '', deviceId: '', platform: 'ios', clientAppVersion: '', osVersion: '', pushToken: '', pushProvider: '' }}
          submitLabel={t('common.create')}
          cancelHref="/backend/devices"
          onSubmit={async (values) => {
            await createCrud('devices/admin/devices', {
              userId: values.userId.trim(),
              deviceId: values.deviceId.trim(),
              platform: values.platform,
              clientAppVersion: trimmedOrUndefined(values.clientAppVersion),
              osVersion: trimmedOrUndefined(values.osVersion),
              pushToken: trimmedOrUndefined(values.pushToken),
              pushProvider: trimmedOrUndefined(values.pushProvider),
            })
            flash(t('devices.form.success.created'), 'success')
            router.push('/backend/devices')
          }}
        />
      </PageBody>
    </Page>
  )
}
