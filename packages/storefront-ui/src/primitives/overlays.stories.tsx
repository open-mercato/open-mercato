import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Popover } from './popover'
import { Tooltip } from './tooltip'
import { Button } from './button'
import { InfoIcon, TrashIcon } from '../lib/icons'

const meta = {
  title: 'Primitives/Popover and Tooltip',
  component: Popover.Content,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '`Popover` for account menus and row overflow actions (`Popover.Menu` rows are 40 px). `Tooltip` for short text on hover and focus only; anything a user must read goes in visible text or a popover.',
      },
    },
  },
} satisfies Meta<typeof Popover.Content>

export default meta
type Story = StoryObj<typeof meta>

export const AccountMenu: Story = {
  render: () => (
    <Popover>
      <Popover.Trigger asChild><Button variant="outline">Ola Nowak</Button></Popover.Trigger>
      <Popover.Content>
        <Popover.Menu>
          <Popover.MenuItem>Orders</Popover.MenuItem>
          <Popover.MenuItem>Shopping lists</Popover.MenuItem>
          <Popover.MenuItem>Addresses</Popover.MenuItem>
          <Popover.MenuItem>Settings</Popover.MenuItem>
          <Popover.MenuItem variant="destructive">Sign out</Popover.MenuItem>
        </Popover.Menu>
      </Popover.Content>
    </Popover>
  ),
}

export const RowActions: Story = {
  render: () => (
    <Popover>
      <Popover.Trigger asChild><Button variant="ghost" size="icon-sm" aria-label="More actions">…</Button></Popover.Trigger>
      <Popover.Content className="w-56">
        <Popover.Menu>
          <Popover.MenuItem>Reorder</Popover.MenuItem>
          <Popover.MenuItem>Download invoice</Popover.MenuItem>
          <Popover.MenuItem icon={<TrashIcon />} variant="destructive">Remove</Popover.MenuItem>
        </Popover.Menu>
      </Popover.Content>
    </Popover>
  ),
}

export const TooltipStory: Story = {
  name: 'Tooltip',
  render: () => (
    <div className="flex items-center gap-2 text-sf-body-sm">
      <span>VAT 23%</span>
      <Tooltip>
        <Tooltip.Trigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="About VAT"><InfoIcon /></Button>
        </Tooltip.Trigger>
        <Tooltip.Content>Calculated on the delivery address.</Tooltip.Content>
      </Tooltip>
    </div>
  ),
}
