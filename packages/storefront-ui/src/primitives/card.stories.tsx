import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Card } from './card'
import { Button } from './button'
import { Badge } from './badge'

const meta = {
  title: 'Primitives/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Bordered white card, tinted `alt` surface, or one of the seven pastel `tile` fills from the Figma v2 set. `interactive` adds hover and a focus ring for cards that are links.',
      },
    },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Summary: Story = {
  render: () => (
    <Card className="max-w-sm">
      <Card.Header>
        <Card.Title>Summary</Card.Title>
      </Card.Header>
      <Card.Body className="text-sf-body-sm text-muted-foreground">
        <div className="flex justify-between"><span>Subtotal</span><span className="text-foreground">381,00 zł</span></div>
        <div className="flex justify-between"><span>Delivery</span><span className="text-foreground">Free</span></div>
        <div className="flex justify-between border-t border-border pt-3 text-sf-body text-foreground"><span>Total</span><span>333,40 zł</span></div>
      </Card.Body>
      <Card.Footer>
        <Button fullWidth size="lg">Checkout</Button>
      </Card.Footer>
    </Card>
  ),
}

export const Tiles: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-2 gap-4">
      <Card surface="tile" tile="fresh" padding="lg">
        <Card.Body>
          <Badge variant="success">Subscription</Badge>
          <Card.Title className="text-sf-display-s">Never run out. Save 10% on every bag.</Card.Title>
          <div><Button>Build your subscription</Button></div>
        </Card.Body>
      </Card>
      <Card surface="tile" tile="bold" padding="lg">
        <Card.Body>
          <Badge variant="new">For cafés</Badge>
          <Card.Title className="text-sf-display-s">Wholesale prices, your own delivery route.</Card.Title>
          <div><Button>Open a trade account</Button></div>
        </Card.Body>
      </Card>
      {(['warm', 'cool', 'soft', 'calm', 'bright'] as const).map((tile) => (
        <Card key={tile} surface="tile" tile={tile} padding="md"><Card.Title className="text-sf-body">{tile}</Card.Title></Card>
      ))}
    </div>
  ),
}

export const Interactive: Story = {
  render: () => (
    <Card asChild interactive className="max-w-sm">
      <a href="#list">
        <Card.Header>
          <Card.Title>Weekly bar order</Card.Title>
          <Badge variant="new">Company</Badge>
        </Card.Header>
        <Card.Body><p className="text-sf-body-xs text-muted-foreground">14 items, updated 2 days ago by Jan Kurek</p></Card.Body>
      </a>
    </Card>
  ),
}
