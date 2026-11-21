import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AspectRatio } from './aspect-ratio'
import { Separator } from './separator'
import { Skeleton } from './skeleton'
import { Spinner } from './spinner'
import { SkipLink } from './skip-link'
import { VisuallyHidden } from './visually-hidden'
import { Button } from './button'

const meta = {
  title: 'Primitives/Layout and loading',
  component: AspectRatio,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '`AspectRatio` uses the product media token (4:5) by default; `Skeleton` tiles share it so loading grids keep their shape. `Spinner` is decorative unless labelled. `SkipLink` is the first focusable element on every page. `VisuallyHidden` carries text for assistive tech, for example “Original price”.',
      },
    },
  },
} satisfies Meta<typeof AspectRatio>

export default meta
type Story = StoryObj<typeof meta>

export const Ratios: Story = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-4 gap-4">
      <AspectRatio ratio="product" className="rounded-sf-tile" />
      <AspectRatio ratio="square" className="rounded-sf-tile" />
      <AspectRatio ratio="landscape" className="rounded-sf-tile" />
      <AspectRatio ratio="wide" className="rounded-sf-tile" />
    </div>
  ),
}

export const Loading: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className="grid grid-cols-4 gap-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3">
            <Skeleton shape="tile" />
            <Skeleton shape="text" lines={2} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <Spinner size={16} label="Loading" />
        <Spinner size={20} />
        <Spinner size={24} />
        <Spinner size={32} />
        <Skeleton shape="circle" className="size-10" />
        <Skeleton shape="rect" className="h-11 w-40" />
      </div>
    </div>
  ),
}

export const Separators: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4 text-sf-body-sm">
      <span>Subtotal</span>
      <Separator />
      <div className="flex h-5 items-center gap-4">
        <span>Terms</span>
        <Separator orientation="vertical" />
        <span>Privacy</span>
      </div>
    </div>
  ),
}

export const SkipLinkStory: Story = {
  name: 'SkipLink (press Tab)',
  render: () => (
    <div className="flex flex-col gap-4">
      <SkipLink targetId="story-main">Skip to content</SkipLink>
      <p className="text-sf-body-xs text-muted-foreground">Press Tab to reveal the skip link.</p>
      <main id="story-main" tabIndex={-1} className="rounded-sf-card border border-border p-4">
        <Button>Add to cart</Button>
        <span className="ml-3 text-sf-body">
          <VisuallyHidden>Original price</VisuallyHidden><s className="text-muted-foreground">129,00 zł</s>{' '}
          <VisuallyHidden>Sale price</VisuallyHidden><span className="text-sf-sale">99,00 zł</span>
        </span>
      </main>
    </div>
  ),
}
