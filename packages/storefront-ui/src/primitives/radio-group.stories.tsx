import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { RadioGroup } from './radio-group'
import { Badge } from './badge'
import { Input } from './input'

const meta = {
  title: 'Primitives/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'One Radix radio group, three variants. `chip` for product options up to about twelve values (weight, grind, size). `card` for delivery, payment, pickup and purchase-mode choices; the right slot takes a price or a logo and children expand when selected. `unavailable` items stay focusable and announce as disabled. Arrow keys move and select, Space selects.',
      },
    },
  },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Chips: Story = {
  render: () => (
    <div className="grid gap-6">
      <RadioGroup variant="chip" defaultValue="250" aria-label="Weight">
        <RadioGroup.Item value="250" label="250 g" />
        <RadioGroup.Item value="1000" label="1 kg" />
        <RadioGroup.Item value="5000" label="5 kg" unavailable description="Out of stock" />
      </RadioGroup>
      <RadioGroup variant="chip" defaultValue="whole" aria-label="Grind">
        <RadioGroup.Item value="whole" label="Whole bean" />
        <RadioGroup.Item value="filter" label="Filter" />
        <RadioGroup.Item value="espresso" label="Espresso" />
      </RadioGroup>
    </div>
  ),
}

export const Cards: Story = {
  name: 'Cards, delivery options',
  render: () => (
    <div className="max-w-xl">
      <RadioGroup variant="card" defaultValue="inpost" aria-label="Delivery">
        <RadioGroup.Item value="inpost" label="InPost parcel locker" description="1 to 2 working days" trailing="12,99 zł" />
        <RadioGroup.Item value="dpd" label="DPD courier" description="Next working day" trailing="16,99 zł" />
        <RadioGroup.Item value="pickup" label="Pickup at the roastery" description="Kraków, Podgórze" trailing="Free" badge={<Badge variant="success">Today</Badge>} />
      </RadioGroup>
    </div>
  ),
}

export const CardsExpandable: Story = {
  name: 'Cards, payment with expanded body',
  render: () => (
    <div className="max-w-xl">
      <RadioGroup variant="card" defaultValue="blik" aria-label="Payment">
        <RadioGroup.Item value="blik" label="BLIK" description="Code from your banking app">
          <Input.Field label="BLIK code">
            <Input inputMode="numeric" placeholder="6 digits" />
          </Input.Field>
        </RadioGroup.Item>
        <RadioGroup.Item value="card" label="Card" description="Visa, Mastercard" />
        <RadioGroup.Item value="invoice" label="Invoice" description="14 days payment terms" badge={<Badge variant="outline">Café partners</Badge>} />
        <RadioGroup.Item value="paylater" label="Pay later" description="Minimum order 50,00 zł" unavailable />
      </RadioGroup>
    </div>
  ),
}

export const PurchaseMode: Story = {
  name: 'Cards, purchase mode',
  render: () => (
    <div className="max-w-md">
      <RadioGroup variant="card" defaultValue="once" aria-label="Purchase">
        <RadioGroup.Item value="once" label="One-time purchase" trailing="129,00 zł" />
        <RadioGroup.Item value="subscribe" label="Subscribe" description="Every 4 weeks, cancel any time" badge={<Badge variant="success">Save 10%</Badge>} trailing="116,10 zł" />
      </RadioGroup>
    </div>
  ),
}

export const Dots: Story = {
  render: () => (
    <div className="max-w-md">
      <RadioGroup defaultValue="draft" aria-label="Status">
        <RadioGroup.Item value="draft" label="Draft" description="Not visible to shoppers" />
        <RadioGroup.Item value="published" label="Published" description="Only a store manager can publish" disabled />
        <RadioGroup.Item value="archived" label="Archived" description="Kept for reference, never shown" />
      </RadioGroup>
    </div>
  ),
}
