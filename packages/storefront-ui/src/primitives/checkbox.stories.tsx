import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox } from './checkbox'

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { label: 'Save this address for next time', variant: 'box' },
  argTypes: { variant: { control: 'select', options: ['box', 'chip', 'switch'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Three visual variants on one Radix checkbox: `box` for forms, `chip` for multi-select facets (filters), `switch` for settings. Chips can be `unavailable`: struck through, still focusable, announced as disabled, never toggled. The whole label is the hit area.',
      },
    },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Box: Story = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <Checkbox label="Billing address same as delivery" defaultChecked />
      <Checkbox label="Email me about new harvests and offers" description="One email a month, unsubscribe any time" />
      <Checkbox label="All lines" checked="indeterminate" />
      <Checkbox label="Accept the terms" disabled />
      <Checkbox aria-label="Select line" />
    </div>
  ),
}

function ChipFacet() {
  const [selected, setSelected] = React.useState<string[]>(['ethiopia'])
  const toggle = (value: string) => (checked: boolean | 'indeterminate') =>
    setSelected((current) => (checked === true ? [...current, value] : current.filter((item) => item !== value)))
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-3 text-sf-body-sm">Origin</legend>
      <Checkbox variant="chip" label="Ethiopia" trailing="12" checked={selected.includes('ethiopia')} onCheckedChange={toggle('ethiopia')} />
      <Checkbox variant="chip" label="Kenya" trailing="8" checked={selected.includes('kenya')} onCheckedChange={toggle('kenya')} />
      <Checkbox variant="chip" label="Colombia" trailing="9" checked={selected.includes('colombia')} onCheckedChange={toggle('colombia')} />
      <Checkbox variant="chip" label="Honey" trailing="0" unavailable />
    </fieldset>
  )
}

export const Chip: Story = {
  render: () => <ChipFacet />,
}

export const Switch: Story = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <Checkbox variant="switch" label="Order updates" defaultChecked />
      <Checkbox variant="switch" label="Approval requests" description="Sent to approvers of your company" defaultChecked />
      <Checkbox variant="switch" label="Buyers can pin products" description="Not available yet" disabled />
    </div>
  ),
}
