import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Dialog } from './dialog'
import { Button } from './button'
import { Badge } from './badge'

const meta = {
  title: 'Primitives/Dialog',
  component: Dialog.Content,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Modal dialog on Radix: focus trapped and returned, Escape cancels, Cmd/Ctrl+Enter activates the button marked `data-dialog-primary`. Sizes 400 / 560 / 720. Use `Sheet` for side panels and mobile bottom sheets.',
      },
    },
  },
} satisfies Meta<typeof Dialog.Content>

export default meta
type Story = StoryObj<typeof meta>

export const Confirm: Story = {
  render: () => (
    <Dialog>
      <Dialog.Trigger asChild>
        <Button variant="outline">Delete “Coffee”</Button>
      </Dialog.Trigger>
      <Dialog.Content size="sm" closeLabel="Close">
        <Dialog.Header>
          <Dialog.Title>Delete “Coffee”?</Dialog.Title>
          <Dialog.Description>Coffee has 4 items under it. They are deleted too.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <ul className="list-disc pl-5 text-sf-body-sm text-muted-foreground">
            <li>Single origin</li>
            <li>Ethiopia</li>
            <li>Kenya</li>
            <li>Espresso blends</li>
          </ul>
        </Dialog.Body>
        <Dialog.Footer layout="equal">
          <Dialog.Close asChild><Button variant="outline">Cancel</Button></Dialog.Close>
          <Button variant="destructive" data-dialog-primary>Delete 5 items</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  ),
}

export const CartChanges: Story = {
  name: 'Cart changes before placing the order',
  render: () => (
    <Dialog defaultOpen>
      <Dialog.Trigger asChild>
        <Button>Place order</Button>
      </Dialog.Trigger>
      <Dialog.Content size="md" closeLabel="Close">
        <Dialog.Header>
          <Dialog.Title>Two things changed</Dialog.Title>
          <Dialog.Description>Nothing has been charged. Review the changes and continue, or go back to the cart.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <div className="flex items-start justify-between gap-4 rounded-sf-field border border-border p-4">
            <div>
              <p className="text-sf-body-sm">Hario V60 dripper</p>
              <p className="text-sf-body-xs text-muted-foreground">Removed from the order. Back on 14 October.</p>
            </div>
            <Badge variant="sold-out">Out of stock</Badge>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-sf-field border border-border p-4">
            <div>
              <p className="text-sf-body-sm">Guji Hambela</p>
              <p className="text-sf-body-xs text-muted-foreground">Was 129,00 zł, now 119,00 zł per bag.</p>
            </div>
            <Badge variant="low-stock">Price changed</Badge>
          </div>
          <div className="flex items-center justify-between text-sf-body">
            <span>New total</span>
            <span>239,99 zł</span>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild><Button variant="outline">Back to cart</Button></Dialog.Close>
          <Button data-dialog-primary>Continue with changes</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  ),
}
