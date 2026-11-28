import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Breadcrumbs } from './breadcrumbs'

const meta = {
  title: 'Primitives/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  args: {
    label: 'Breadcrumb',
    backLabel: 'Back to',
    items: [{ label: 'Home', href: '#' }, { label: 'Coffee', href: '#coffee' }, { label: 'Guji Hambela' }],
  },
  parameters: {
    docs: {
      description: {
        component: 'Slash separator, 13 px, last item is `aria-current="page"`. With `backLabel` the trail collapses to a single “Back to parent” link under the `sm` breakpoint.',
      },
    },
  },
} satisfies Meta<typeof Breadcrumbs>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'phone' } },
}
