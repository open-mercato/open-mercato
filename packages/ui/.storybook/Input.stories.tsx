import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { UserRound } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

const meta = {
  title: 'Playgrounds/Input',
  component: Input,
  tags: ['autodocs'],
  args: { value: '', placeholder: 'Customer name', size: 'default', disabled: false, readOnly: false, 'aria-invalid': false },
  argTypes: {
    size: { control: 'select', options: ['sm', 'default', 'lg'], description: 'sm = 32 px, default = 36 px, lg = 40 px.' },
    value: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    'aria-invalid': { control: 'boolean' },
    leftIcon: { control: false },
    rightIcon: { control: false },
  },
  parameters: {
    docs: { description: { component: 'A labelled text field using the production Input and FormField. Edit the value here or in Controls. Use Tab to inspect the real focus state. Figma Small (36) corresponds to size="default".' } },
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs()
    return <div className="om-entry"><div className="max-w-lg">
      <FormField label="Customer name" description="The name shown on customer records." disabled={args.disabled} error={args['aria-invalid'] ? 'Enter a customer name.' : undefined}>
        <Input {...args} onChange={event => updateArgs({ value: event.target.value })} />
      </FormField>
    </div></div>
  },
} satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
export const WithIcon: Story = { args: { leftIcon: <UserRound aria-hidden="true" /> } }
export const Invalid: Story = { args: { 'aria-invalid': true } }
export const ReadOnly: Story = { args: { value: 'Open Mercato', readOnly: true } }
export const Disabled: Story = { args: { value: 'Open Mercato', disabled: true, leftIcon: <UserRound aria-hidden="true" /> } }
