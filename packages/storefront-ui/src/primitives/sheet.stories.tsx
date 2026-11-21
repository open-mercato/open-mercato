import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Sheet } from './sheet'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { Separator } from './separator'

const meta = {
  title: 'Primitives/Sheet',
  component: Sheet.Content,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Side panel (420 px) for the mini-cart and filters on desktop, bottom sheet with a grabber for filters and sort on mobile. Same keyboard contract as Dialog; the footer is sticky and respects the safe area.',
      },
    },
  },
} satisfies Meta<typeof Sheet.Content>

export default meta
type Story = StoryObj<typeof meta>

const filters = (
  <>
    <Sheet.Header>
      <Sheet.Title>Filters</Sheet.Title>
    </Sheet.Header>
    <Sheet.Body>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-3 text-sf-body-sm">Origin</legend>
        <Checkbox variant="chip" label="Ethiopia" trailing="12" defaultChecked />
        <Checkbox variant="chip" label="Kenya" trailing="8" />
        <Checkbox variant="chip" label="Colombia" trailing="9" />
        <Checkbox variant="chip" label="Brazil" trailing="15" />
      </fieldset>
      <Separator />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-3 text-sf-body-sm">Process</legend>
        <Checkbox variant="chip" label="Washed" trailing="22" />
        <Checkbox variant="chip" label="Natural" trailing="17" />
        <Checkbox variant="chip" label="Honey" trailing="0" unavailable />
      </fieldset>
    </Sheet.Body>
    <Sheet.Footer className="sm:flex-row">
      <Button variant="outline" fullWidth>Clear all</Button>
      <Button fullWidth>Show 12 coffees</Button>
    </Sheet.Footer>
  </>
)

export const Right: Story = {
  render: () => (
    <Sheet>
      <Sheet.Trigger asChild><Button variant="outline">Open filters</Button></Sheet.Trigger>
      <Sheet.Content side="right" closeLabel="Close">{filters}</Sheet.Content>
    </Sheet>
  ),
}

export const Bottom: Story = {
  name: 'Bottom sheet (mobile)',
  parameters: { viewport: { defaultViewport: 'phone' } },
  render: () => (
    <Sheet defaultOpen>
      <Sheet.Trigger asChild><Button variant="outline">Open filters</Button></Sheet.Trigger>
      <Sheet.Content side="bottom" closeLabel="Close">{filters}</Sheet.Content>
    </Sheet>
  ),
}
