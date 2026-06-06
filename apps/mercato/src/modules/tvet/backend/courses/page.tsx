'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function CoursesPage() {
  const { t } = useT()
  const router = useRouter()
  const [search, setSearch] = React.useState('')

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('tvet.academics.courses.title', 'Courses')}
          endpoint="/api/tvet/courses"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('tvet.academics.courses.searchPlaceholder', 'Search courses...')}
          actions={(
            <Button asChild>
              <Link href="/backend/tvet/courses/create">
                {t('tvet.academics.courses.actions.new', 'New Course')}
              </Link>
            </Button>
          )}
          columns={[
            { key: 'code', label: t('tvet.academics.courses.code', 'Code'), sortable: true },
            { key: 'name', label: t('tvet.academics.courses.name', 'Name'), sortable: true },
            { key: 'level', label: t('tvet.academics.courses.level', 'Level'), sortable: true },
            { key: 'durationMonths', label: t('tvet.academics.courses.duration', 'Duration (Months)'), sortable: true },
            { key: 'createdAt', label: t('common.createdAt', 'Created At'), type: 'date', sortable: true },
          ]}
          onRowClick={(row) => router.push(`/backend/tvet/courses/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('common.view', 'View'),
                  onSelect: () => router.push(`/backend/tvet/courses/${row.id}`),
                },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
