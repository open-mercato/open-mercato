import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './button'
import { PlusIcon, SearchIcon, TrashIcon } from '../lib/icons'

const meta = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Add to cart', variant: 'default', size: 'default' },
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline', 'secondary', 'ghost', 'link', 'destructive'] },
    size: { control: 'select', options: ['sm', 'default', 'lg', 'icon', 'icon-sm'] },
  },
  parameters: {
    docs: {
      description: {
        component:
          'One primary per view. Heights 36 / 44 / 52 px follow the control-size tokens; the radius follows the shape preset. `loading` keeps the width and leaves the label in the DOM for assistive tech. ARIA: native button, `aria-busy` while loading, visible focus ring on every variant.',
      },
    },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Add to cart</Button>
      <Button variant="outline">Add to list</Button>
      <Button variant="secondary">Clear all</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="link">Sign in</Button>
      <Button variant="destructive">Remove</Button>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Load more</Button>
      <Button size="default">Add to cart</Button>
      <Button size="lg">Place order</Button>
      <Button size="icon" aria-label="Search"><SearchIcon /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Remove"><TrashIcon /></Button>
    </div>
  ),
}

export const WithIconsAndPrice: Story = {
  name: 'Icons and trailing price',
  render: () => (
    <div className="flex max-w-sm flex-col gap-3">
      <Button size="lg" fullWidth trailing="129,00 zł">Add to cart</Button>
      <Button variant="outline" leadingIcon={<PlusIcon />}>Add row</Button>
      <Button variant="outline" trailingIcon={<SearchIcon />}>Search orders</Button>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button loading>Add to cart</Button>
      <Button variant="outline" loading>Refresh preview</Button>
      <Button disabled>Add to cart</Button>
      <Button variant="outline" disabled>Sync when online</Button>
    </div>
  ),
}

export const AsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#products">Browse all coffee</a>
    </Button>
  ),
}
