import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Tabs } from './tabs'

const meta = {
  title: 'Primitives/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'WAI-ARIA tabs without Radix (not on the allowed dependency list): roving tabindex, arrow keys, Home and End, automatic activation. `underline` for page sections, `pill` for category rows, `segmented` for 2 to 4 views such as “My orders / Company orders”.',
      },
    },
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

const panels = (
  <>
    <Tabs.Content value="all"><p className="text-sf-body text-muted-foreground">All 42 orders.</p></Tabs.Content>
    <Tabs.Content value="active"><p className="text-sf-body text-muted-foreground">3 orders in progress.</p></Tabs.Content>
    <Tabs.Content value="past"><p className="text-sf-body text-muted-foreground">39 delivered or cancelled orders.</p></Tabs.Content>
  </>
)

export const Underline: Story = {
  render: () => (
    <Tabs defaultValue="all" className="max-w-xl">
      <Tabs.List aria-label="Orders">
        <Tabs.Trigger value="all" trailing="42">All</Tabs.Trigger>
        <Tabs.Trigger value="active" trailing="3">Active</Tabs.Trigger>
        <Tabs.Trigger value="past">Past</Tabs.Trigger>
        <Tabs.Trigger value="returns" disabled>Returns</Tabs.Trigger>
      </Tabs.List>
      {panels}
    </Tabs>
  ),
}

export const Pill: Story = {
  render: () => (
    <Tabs defaultValue="all" variant="pill" className="max-w-xl">
      <Tabs.List aria-label="Categories">
        <Tabs.Trigger value="all">All</Tabs.Trigger>
        <Tabs.Trigger value="active">Coffee</Tabs.Trigger>
        <Tabs.Trigger value="past">Cups and filters</Tabs.Trigger>
      </Tabs.List>
      {panels}
    </Tabs>
  ),
}

export const Segmented: Story = {
  render: () => (
    <Tabs defaultValue="active" variant="segmented" className="max-w-xl">
      <Tabs.List aria-label="Scope">
        <Tabs.Trigger value="all">My orders</Tabs.Trigger>
        <Tabs.Trigger value="active">Company orders</Tabs.Trigger>
      </Tabs.List>
      {panels}
    </Tabs>
  ),
}
