import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

const meta = {
  title: 'Playgrounds/PasswordInput',
  component: PasswordInput,
  tags: ['autodocs'],
  args: { value: 'Example-password', size: 'default', disabled: false, revealable: true, revealed: false, showLockIcon: true, 'aria-invalid': false, showLabel: 'Show password', hideLabel: 'Hide password', autoComplete: 'off' },
  argTypes: {
    value: { control: 'text' },
    size: { control: 'select', options: ['sm', 'default', 'lg'] },
    disabled: { control: 'boolean' },
    revealable: { control: 'boolean' },
    revealed: { control: 'boolean' },
    showLockIcon: { control: 'boolean' },
    'aria-invalid': { control: 'boolean' },
  },
  parameters: { docs: { description: { component: 'A local example value. Reveal state and text stay synchronized with Controls. The reveal action is keyboard accessible and disabled together with the input.' } } },
  render: function Render(args) {
    const [, updateArgs] = useArgs()
    return <div className="om-entry"><div className="max-w-lg">
      <FormField label="Password" description="Use an example value in this preview." disabled={args.disabled} error={args['aria-invalid'] ? 'Use at least 12 characters.' : undefined}>
        <PasswordInput {...args} onChange={event => updateArgs({ value: event.target.value })} onRevealedChange={revealed => updateArgs({ revealed })} />
      </FormField>
    </div></div>
  },
} satisfies Meta<typeof PasswordInput>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
export const Invalid: Story = { args: { value: 'short', 'aria-invalid': true } }
export const Disabled: Story = { args: { disabled: true } }
