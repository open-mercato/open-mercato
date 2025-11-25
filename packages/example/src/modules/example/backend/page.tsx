"use client"
import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import Link from 'next/link'
import { useT } from '@/lib/i18n/context'

export default function ExampleAdminIndex() {
  const t = useT()
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
      </PageBody>
    </Page>
  )
}
