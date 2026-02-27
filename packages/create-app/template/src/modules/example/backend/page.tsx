"use client"
import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DatePicker, DateTimePicker, TimePicker } from '@open-mercato/ui/backend/inputs'

export default function ExampleAdminIndex() {
  const t = useT()
  const [date, setDate] = React.useState<Date | null>(null)
  const [datetime, setDatetime] = React.useState<Date | null>(null)
  const [time, setTime] = React.useState<string | null>(null)

  return (
    <Page>
      <PageHeader title={t('example.admin.page.title', 'Example Admin')} description={t('example.admin.page.description', 'Demo resources for the example module.')} />
      <PageBody>
        <div className="rounded-lg border p-4">
          <div className="text-sm mb-2">{t('example.admin.page.resources', 'Resources')}</div>
          <ul className="list-disc list-inside text-sm">
            <li>
              <Link className="underline" href="/backend/todos">{t('example.admin.page.todosList', 'Todos list')}</Link>
            </li>
          </ul>
        </div>

        {/* TEMP: Date picker demo — revert before commit (git checkout -- apps/mercato/src/modules/example/backend/page.tsx) */}
        <div className="mt-6 rounded-lg border p-4">
          <div className="text-sm font-medium mb-4">Date pickers (demo — do not commit)</div>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground">DatePicker</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground">DateTimePicker</label>
              <DateTimePicker value={datetime} onChange={setDatetime} />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground">TimePicker</label>
              <TimePicker value={time} onChange={setTime} />
            </div>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
