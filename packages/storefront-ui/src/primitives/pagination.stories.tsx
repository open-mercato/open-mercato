import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Pagination } from './pagination'

const meta = {
  title: 'Primitives/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Numbered pagination (36 px targets, `aria-current="page"`) for tables and B2B lists. Storefront listings use `Pagination.LoadMore`: “Showing X of Y”, a thin progress bar and one button; the app moves focus to the first new item after loading.',
      },
    },
  },
} satisfies Meta<typeof Pagination>

export default meta
type Story = StoryObj<typeof meta>

function Numbered() {
  const [page, setPage] = React.useState(4)
  return <Pagination page={page} pageCount={12} onPageChange={setPage} labels={{ navigation: 'Orders pages', previous: 'Previous page', next: 'Next page', page: (n) => `Page ${n}` }} />
}

export const Numbered_: Story = { name: 'Numbered', render: () => <Numbered /> }

function LoadMore() {
  const [shown, setShown] = React.useState(8)
  const [loading, setLoading] = React.useState(false)
  return (
    <Pagination.LoadMore
      shown={shown}
      total={48}
      loading={loading}
      labels={{ showing: `Showing ${shown} of 48`, loadMore: 'Load more' }}
      onLoadMore={() => { setLoading(true); setTimeout(() => { setShown((value) => Math.min(48, value + 8)); setLoading(false) }, 600) }}
    />
  )
}

export const LoadMore_: Story = { name: 'Pagination.LoadMore', render: () => <LoadMore /> }
