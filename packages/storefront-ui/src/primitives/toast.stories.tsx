import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Toast } from './toast'
import { Button } from './button'

const meta = {
  title: 'Primitives/Toast',
  component: Toast.Provider,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Transient feedback with at most one action, at most two stacked, 5 s by default. Error toasts never auto-dismiss and announce assertively, but an error that needs fixing belongs in an `Alert` or a field error, not here. One `cart.itemAdded` event drives either a toast (mobile) or the mini-cart sheet (desktop).',
      },
    },
  },
} satisfies Meta<typeof Toast.Provider>

export default meta
type Story = StoryObj<typeof meta>

function Triggers() {
  const { toast } = Toast.useToast()
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => toast({ title: 'Guji Hambela added to your cart', status: 'success', action: { label: 'View cart', onClick: () => {} } })}>Add to cart</Button>
      <Button variant="outline" onClick={() => toast({ title: 'Paper filters removed', action: { label: 'Undo', onClick: () => {} } })}>Remove line</Button>
      <Button variant="outline" onClick={() => toast({ title: 'Link copied', duration: 2500 })}>Copy link</Button>
      <Button variant="outline" onClick={() => toast({ title: 'Could not save the list', description: 'Check your connection and try again.', status: 'error' })}>Error</Button>
    </div>
  )
}

export const Playground: Story = {
  render: () => <Triggers />,
}
