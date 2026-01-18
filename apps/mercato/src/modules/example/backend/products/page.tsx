"use client"
import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ProductRow = {
  id: string
  product: string
  collection: string
  channels: string
  variants: string
  status: string
}

const demoData: ProductRow[] = [
  { id: '1', product: 'ThinkPad', collection: 'Professional products', channels: 'Webshop, B2B Portal + 3 more', variants: '4 variants', status: 'Published' },
  { id: '2', product: 'Apple Watch', collection: 'Winter sale collection', channels: 'Webshop, App + 1 more', variants: '2 variants', status: 'Published' },
]

export default function ExampleProductsListPage() {
  const t = useT()
  const [rows] = React.useState(demoData)

  const columns: ColumnDef<ProductRow>[] = React.useMemo(() => [
    { accessorKey: 'product', header: t('example.products.table.column.product', 'Product') },
    { accessorKey: 'collection', header: t('example.products.table.column.collection', 'Collection') },
    { accessorKey: 'channels', header: t('example.products.table.column.channels', 'Sales Channels') },
    { accessorKey: 'variants', header: t('example.products.table.column.variants', 'Variants') },
    { accessorKey: 'status', header: t('example.products.table.column.status', 'Status') },
  ], [t])

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button variant="outline">{t('example.products.actions.export', 'Export')}</Button>
      <Button variant="outline">{t('example.products.actions.import', 'Import')}</Button>
      <Button>{t('example.products.actions.create', 'Create')}</Button>
    </div>
  )

  return (
    <Page>
      <PageHeader title={t('example.products.page.title', 'Products')} actions={toolbar} />
      <PageBody>
        <DataTable
          columns={columns}
          data={rows}
          toolbar={<Button variant="outline">{t('example.products.actions.addFilter', 'Add filter')}</Button>}
          perspective={{ tableId: 'example.products.list' }}
        />
      </PageBody>
    </Page>
  )
}
