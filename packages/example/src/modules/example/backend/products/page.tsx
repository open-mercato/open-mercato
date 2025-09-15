"use client"
import * as React from 'react'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ColumnDef } from '@tanstack/react-table'

type ProductRow = {
  id: string
  product: string
  collection: string
  channels: string
  variants: string
  status: string
}

const columns: ColumnDef<ProductRow>[] = [
  { accessorKey: 'product', header: 'Product' },
  { accessorKey: 'collection', header: 'Collection' },
  { accessorKey: 'channels', header: 'Sales Channels' },
  { accessorKey: 'variants', header: 'Variants' },
  { accessorKey: 'status', header: 'Status' },
]

const demoData: ProductRow[] = [
  { id: '1', product: 'ThinkPad', collection: 'Professional products', channels: 'Webshop, B2B Portal + 3 more', variants: '4 variants', status: 'Published' },
  { id: '2', product: 'Apple Watch', collection: 'Winter sale collection', channels: 'Webshop, App + 1 more', variants: '2 variants', status: 'Published' },
]

export default function ExampleProductsListPage() {
  const [rows] = React.useState(demoData)
  const toolbar = (
    <div className="flex items-center gap-2">
      <Button variant="outline">Export</Button>
      <Button variant="outline">Import</Button>
      <Button>Create</Button>
    </div>
  )

  return (
    <Page>
      <PageHeader title="Products" actions={toolbar} />
      <PageBody>
        <DataTable columns={columns} data={rows} toolbar={<Button variant="outline">Add filter</Button>} />
      </PageBody>
    </Page>
  )
}
