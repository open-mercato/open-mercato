import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { fn } from 'storybook/test'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'

const meta = {
  title: 'Playgrounds/SearchInput',
  component: SearchInput,
  tags: ['autodocs'],
  args: { value: 'Acme', onChange: fn(), placeholder: 'Search customers', size: 'default', clearable: true, disabled: false, clearLabel: 'Clear search' },
  argTypes: {
    value: { control: 'text' },
    placeholder: { control: 'text' },
    size: { control: 'select', options: ['sm', 'default', 'lg'] },
    clearable: { control: 'boolean' },
    disabled: { control: 'boolean' },
    onChange: { control: false },
  },
  parameters: { docs: { description: { component: 'Controlled search value, synchronized with Controls. Type or use the clear action to update the local value. Tab reaches the clear action when the field contains text.' } } },
  render: function Render(args) {
    const [, updateArgs] = useArgs()
    return <div className="om-entry"><div className="max-w-lg">
      <FormField label="Find a customer" description="Local example; no search request is sent." disabled={args.disabled}>
        <SearchInput {...args} onChange={value => { args.onChange(value); updateArgs({ value }) }} />
      </FormField>
    </div></div>
  },
} satisfies Meta<typeof SearchInput>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
export const Empty: Story = { args: { value: '' } }
export const Disabled: Story = { args: { disabled: true } }
