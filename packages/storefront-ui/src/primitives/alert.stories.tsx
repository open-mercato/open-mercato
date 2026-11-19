import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Alert } from './alert'

const meta = {
  title: 'Primitives/Alert',
  component: Alert,
  tags: ['autodocs'],
  args: { status: 'information', children: 'Sorting by price is not offered for this catalogue. Showing recommended order.' },
  parameters: {
    docs: {
      description: {
        component:
          'Inline notice. Error status renders `role="alert"`; the others `role="status"`. The only error channel in cart and checkout besides field errors: cause plus next step, never raw gateway text.',
      },
    },
  },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Tones: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-3">
      <Alert status="neutral">Order by price is approximate. Your prices can differ from this order.</Alert>
      <Alert status="information">Prices and stock are held for 15 minutes. 12 minutes left.</Alert>
      <Alert status="success" action={<button type="button">Undo</button>}>Block “Rich text, Roasting notes” removed.</Alert>
      <Alert status="warning" title="This preview expired">Prices and stock may have changed after 15 minutes.</Alert>
      <Alert status="error" title="We could not take the payment" action={<button type="button">Try another card</button>}>
        Your bank declined the card ending 4242. Nothing has been charged.
      </Alert>
    </div>
  ),
}

export const Dismissible: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Alert status="warning" dismissLabel="Dismiss" onDismiss={() => {}}>ZR-10451 was already approved by Jan Kurek 2 minutes ago. The list has been refreshed.</Alert>
    </div>
  ),
}
