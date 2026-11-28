import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Select } from './select'
import { Input } from './input'

const meta = {
  title: 'Primitives/Select',
  component: Select.Trigger,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Radix select with a 44 px trigger. Use it for sort, country and B2B filters; sizes and variants of a product are chips (`RadioGroup variant="chip"`), not selects. Keyboard: Space/Enter open, arrows move, type-ahead, Escape closes.',
      },
    },
  },
} satisfies Meta<typeof Select.Trigger>

export default meta
type Story = StoryObj<typeof meta>

export const Sort: Story = {
  render: () => (
    <div className="max-w-xs">
      <Select defaultValue="recommended">
        <Select.Trigger aria-label="Sort by">
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="recommended">Recommended</Select.Item>
          <Select.Item value="newest">Newest</Select.Item>
          <Select.Item value="rating">Best rated</Select.Item>
          <Select.Item value="price_asc">Price, low to high</Select.Item>
          <Select.Item value="price_desc">Price, high to low</Select.Item>
        </Select.Content>
      </Select>
    </div>
  ),
}

export const WithFieldAndGroups: Story = {
  name: 'In a field, grouped, with descriptions',
  render: () => (
    <div className="max-w-md">
      <Input.Field label="Delivery route" helper="Set by your account manager" required>
        <Select defaultValue="thu">
          <Select.Trigger>
            <Select.Value placeholder="Choose a route" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Label>Kraków</Select.Label>
              <Select.Item value="tue" description="Orders by Monday 18:00">Tuesday route</Select.Item>
              <Select.Item value="thu" description="Orders by Wednesday 18:00">Thursday route</Select.Item>
            </Select.Group>
            <Select.Separator />
            <Select.Group>
              <Select.Label>Courier</Select.Label>
              <Select.Item value="dpd">DPD, next working day</Select.Item>
              <Select.Item value="pickup" disabled>Pickup at the roastery</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select>
      </Input.Field>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="grid max-w-xs gap-3">
      <Select>
        <Select.Trigger size="sm"><Select.Value placeholder="Small" /></Select.Trigger>
        <Select.Content><Select.Item value="a">Option</Select.Item></Select.Content>
      </Select>
      <Select>
        <Select.Trigger invalid><Select.Value placeholder="Invalid" /></Select.Trigger>
        <Select.Content><Select.Item value="a">Option</Select.Item></Select.Content>
      </Select>
      <Select disabled>
        <Select.Trigger><Select.Value placeholder="Disabled" /></Select.Trigger>
        <Select.Content><Select.Item value="a">Option</Select.Item></Select.Content>
      </Select>
    </div>
  ),
}
