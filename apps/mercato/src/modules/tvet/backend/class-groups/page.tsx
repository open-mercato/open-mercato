'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ClassGroupsPage() {
  const { t } = useT()
  const router = useRouter()
  const [search, setSearch] = React.useState('')

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('tvet.academics.classGroups.title', 'Class Groups')}
          endpoint="/api/tvet/class-groups"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('tvet.academics.classGroups.searchPlaceholder', 'Search class groups...')}
          actions={(
            <Button asChild>
              <Link href="/backend/tvet/class-groups/create">
                {t('tvet.academics.classGroups.actions.new', 'New Class Group')}
              </Link>
            </Button>
          )}
          columns={[
            { key: 'name', label: t('tvet.academics.classGroups.name', 'Name'), sortable: true },
            { key: 'course.name', label: t('tvet.academics.courses.name', 'Course'), sortable: true },
            { key: 'createdAt', label: t('common.createdAt', 'Created At'), type: 'date', sortable: true },
          ]}
          onRowClick={(row) => router.push(`/backend/tvet/class-groups/${row.id}`)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('common.view', 'View'),
                  onSelect: () => router.push(`/backend/tvet/class-groups/${row.id}`),
                },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
