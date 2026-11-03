import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

const variants = ['default', 'outline', 'secondary', 'ghost', 'muted', 'destructive', 'destructive-outline', 'destructive-soft', 'destructive-ghost', 'link'] as const
const meta = {
  title: 'Playgrounds/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save changes', variant: 'default', size: 'default', disabled: false, type: 'button' },
  argTypes: { variant: { control: 'select', options: variants }, size: { control: 'select', options: ['2xs', 'sm', 'default', 'lg'] }, children: { control: 'text' }, disabled: { control: 'boolean' } },
  decorators: [(Story) => <div className="om-entry"><Story /></div>],
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>
export const Playground: Story = {}
export const Disabled: Story = { args: { disabled: true } }
export const WithIcon: Story = { render: (args) => <Button {...args}><Plus className="size-4" />Create customer</Button> }
export const VariantMatrix: Story = {
  render: () => <div className="space-y-6"><h1 className="text-2xl font-semibold">Actions at every emphasis</h1>
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{variants.map(variant => <section key={variant} className="space-y-4 rounded-lg border border-border p-6"><h2 className="font-mono text-xs text-muted-foreground">{variant}</h2><div className="flex flex-wrap gap-3"><Button type="button" variant={variant}>Action</Button><Button type="button" variant={variant} disabled>Disabled</Button></div></section>)}</div>
  </div>,
}
function ActionDemo() {
  const [count, setCount] = React.useState(0)
  return <div className="space-y-4"><Button type="button" onClick={() => setCount(value => value + 1)}>Add to selection</Button><p role="status" className="text-sm">{count} selected</p></div>
}
export const KeyboardAndClick: Story = {
  render: () => <ActionDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add to selection' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('1 selected')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('2 selected')
  },
}
