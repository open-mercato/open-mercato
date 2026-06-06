'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function TraineesPage() {
  const { t } = useT()
  const router = useRouter()
  const [search, setSearch] = React.useState('')

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('tvet.academics.trainees.title', 'Trainees')}
          endpoint="/api/tvet/trainees"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('tvet.academics.trainees.searchPlaceholder', 'Search trainees...')}
          actions={(
            <Button asChild>
              <Link href="/backend/tvet/trainees/create">
                {t('tvet.academics.trainees.actions.new', 'New Trainee')}
              </Link>
            </Button>
          )}
          columns={[
            { key: 'admissionNumber', label: t('tvet.academics.trainees.admissionNumber', 'Admission #'), sortable: true },
            { key: 'name', label: t('tvet.academics.trainees.name', 'Name'), sortable: true },
            { key: 'email', label: t('tvet.academics.trainees.email', 'Email'), sortable: true },
            { key: 'createdAt', label: t('common.createdAt', 'Created At'), type: 'date', sortable: true },
          ]}
          onRowClick={(row) => router.push(`/backend/tvet/trainees/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('common.view', 'View'),
                  onSelect: () => router.push(`/backend/tvet/trainees/${row.id}`),
                },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
