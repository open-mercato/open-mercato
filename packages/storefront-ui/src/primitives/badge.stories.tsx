import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge, type BadgeStatus } from './badge'

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'New harvest', variant: 'neutral', size: 'default' },
  parameters: {
    docs: {
      description: {
        component:
          'Tones pair colour with text; never the only signal. On a product tile keep at most one image badge and one meta badge. `Badge.Status` maps order, payment and quote lifecycles to tones with a leading dot; labels come from the app locale files. Text never drops below 11 px.',
      },
    },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="outline">Café partners</Badge>
      <Badge variant="default">−23%</Badge>
      <Badge variant="promo">Sale</Badge>
      <Badge variant="new">New</Badge>
      <Badge variant="low-stock">Only 2 left</Badge>
      <Badge variant="sold-out">Sold out</Badge>
      <Badge variant="info">Ships tomorrow</Badge>
      <Badge variant="success">In stock</Badge>
      <Badge variant="warning">Awaiting approval</Badge>
      <Badge variant="error">Cancelled</Badge>
      <Badge variant="neutral">Ripe peach</Badge>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge size="sm">Small</Badge>
      <Badge size="default">Medium</Badge>
      <Badge size="lg">Large</Badge>
    </div>
  ),
}

const statuses: Array<[BadgeStatus, string]> = [
  ['placed', 'Placed'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'],
  ['awaiting_approval', 'Awaiting approval'], ['on_hold', 'On hold'], ['cancelled', 'Cancelled'], ['returned', 'Returned'],
  ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['expired', 'Expired'],
]

export const Status: Story = {
  name: 'Badge.Status',
  render: () => (
    <div className="flex flex-wrap gap-2">
      {statuses.map(([status, label]) => (
        <Badge.Status key={status} status={status}>{label}</Badge.Status>
      ))}
    </div>
  ),
}
