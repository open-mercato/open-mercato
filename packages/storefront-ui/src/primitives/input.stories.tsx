import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from './input'
import { TrashIcon } from '../lib/icons'

const meta = {
  title: 'Primitives/Input',
  component: Input,
  tags: ['autodocs'],
  args: { placeholder: 'ola@example.com', size: 'default' },
  parameters: {
    docs: {
      description: {
        component:
          'Stacked visible label, outlined field, helper and error below. `Input.Field` wires `id`, `aria-describedby`, `aria-invalid` and `required` into one control. Checkout uses `size="lg"` (48 px); B2B tables use `size="sm"`. `Input.Stepper` is an editable quantity with announced value; `Input.Search` adds the icon and a labelled clear button.',
      },
    },
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Field: Story = {
  name: 'Input.Field',
  render: () => (
    <div className="grid max-w-xl gap-5">
      <Input.Field label="Email" helper="Order updates go here" required>
        <Input type="email" placeholder="ola@example.com" />
      </Input.Field>
      <Input.Field label="Postcode" error="Enter a postcode in the format 00-000">
        <Input defaultValue="31-05" inputMode="numeric" />
      </Input.Field>
      <Input.Field label="Delivery notes" optionalLabel="(optional)">
        <Input placeholder="Leave at the back door" />
      </Input.Field>
      <Input.Field label="Company">
        <Input defaultValue="Kawiarnia Bez" disabled />
      </Input.Field>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="grid max-w-md gap-3">
      <Input size="sm" placeholder="Small, B2B tables" />
      <Input size="default" placeholder="Medium, default" />
      <Input size="lg" placeholder="Large, checkout" />
    </div>
  ),
}

function StepperDemo({ removeAtMin }: { removeAtMin?: boolean }) {
  const [value, setValue] = React.useState(removeAtMin ? 1 : 12)
  return (
    <Input.Stepper
      value={value}
      onValueChange={setValue}
      min={removeAtMin ? 1 : 6}
      max={240}
      step={removeAtMin ? 1 : 6}
      removeAtMin={removeAtMin}
      removeIcon={<TrashIcon />}
      labels={{ decrease: 'Decrease quantity', increase: 'Increase quantity', value: 'Quantity' }}
    />
  )
}

export const Stepper: Story = {
  name: 'Input.Stepper',
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <StepperDemo />
      <StepperDemo removeAtMin />
      <Input.Stepper size="sm" value={2} onValueChange={() => {}} labels={{ decrease: 'Decrease', increase: 'Increase', value: 'Quantity' }} />
      <Input.Stepper value={1} onValueChange={() => {}} disabled labels={{ decrease: 'Decrease', increase: 'Increase', value: 'Quantity' }} />
    </div>
  ),
}

function SearchDemo() {
  const [value, setValue] = React.useState('ethiopia')
  return <Input.Search value={value} onChange={(event) => setValue(event.target.value)} onClear={() => setValue('')} clearLabel="Clear search" placeholder="Search coffee, gear, SKU" aria-label="Search" />
}

export const Search: Story = {
  name: 'Input.Search',
  render: () => (
    <div className="max-w-md">
      <SearchDemo />
    </div>
  ),
}
