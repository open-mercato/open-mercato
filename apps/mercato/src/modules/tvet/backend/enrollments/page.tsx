'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function EnrollmentsPage() {
  const { t } = useT()
  const router = useRouter()
  const [search, setSearch] = React.useState('')

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('tvet.academics.enrollments.title', 'Enrollments')}
          endpoint="/api/tvet/enrollments"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('tvet.academics.enrollments.searchPlaceholder', 'Search enrollments...')}
          actions={(
            <Button asChild>
              <Link href="/backend/tvet/enrollments/create">
                {t('tvet.academics.enrollments.actions.new', 'New Enrollment')}
              </Link>
            </Button>
          )}
          columns={[
            { key: 'trainee.name', label: t('tvet.academics.trainees.name', 'Trainee'), sortable: true },
            { key: 'classGroup.name', label: t('tvet.academics.classGroups.name', 'Class Group'), sortable: true },
            { key: 'status', label: t('common.status', 'Status'), sortable: true },
            { key: 'enrolledAt', label: t('tvet.academics.enrollments.enrolledAt', 'Enrolled At'), type: 'date', sortable: true },
          ]}
          onRowClick={(row) => router.push(`/backend/tvet/enrollments/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('common.view', 'View'),
                  onSelect: () => router.push(`/backend/tvet/enrollments/${row.id}`),
                },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
