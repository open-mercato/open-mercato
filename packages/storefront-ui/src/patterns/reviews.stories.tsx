import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Dialog } from '../primitives/dialog'
import { Input } from '../primitives/input'
import { Sheet } from '../primitives/sheet'
import { ProductGrid, StarIcon, photos, sampleProducts } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront), drawn on the DS library page
 * "Reviews and account [E-commerce]". Nothing in this file is exported.
 * Reviews and favourites have no backend yet; the empty states are the launch states.
 */
const meta = {
  title: 'Patterns/Reviews and account',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

function Stars({ value, className = 'size-3.5' }: { value: number; className?: string }) {
  return (
    <span role="img" aria-label={`${value} out of 5 stars`} className="flex gap-px">
      {[1, 2, 3, 4, 5].map((star) => <StarIcon key={star} filled={star <= value} className={`${className} ${star <= value ? '' : 'text-border'}`} />)}
    </span>
  )
}

const distribution: Array<[number, number]> = [[5, 100], [4, 18], [3, 6], [2, 3], [1, 1]]

function RatingSummary({ empty, action }: { empty?: boolean; action: React.ReactNode }) {
  if (empty) return <div className="flex flex-col items-start gap-4"><p className="text-sf-title">No reviews yet</p>{action}</div>
  return (
    <div className="flex w-full flex-col items-start gap-4 lg:w-90">
      <p className="text-sf-display-s lg:text-sf-display-l">4.8</p>
      <p className="flex items-center gap-2 text-sf-body text-muted-foreground"><Stars value={5} className="size-4 text-foreground" />128 reviews</p>
      <dl className="flex w-full flex-col gap-2 text-sf-body-xs">
        {distribution.map(([stars, count]) => (
          <div key={stars} className="flex items-center gap-2.5">
            <dt className="w-2">{stars}<span className="sr-only"> stars</span></dt>
            <dd className="flex flex-1 items-center gap-2.5">
              <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full bg-foreground" style={{ width: `${Math.round((count / 128) * 100)}%` }} /></span>
              <span className="w-6 text-right text-muted-foreground">{count}</span>
            </dd>
          </div>
        ))}
      </dl>
      {action}
    </div>
  )
}

function ReviewCard({ rating, title, text, author, date, verified }: { rating: number; title: string; text: string; author: string; date: string; verified?: boolean }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-sf-card bg-sf-surface p-5">
      <Stars value={rating} />
      <h3 className="text-sf-body-lg">{title}</h3>
      <p className="text-sf-body">{text}</p>
      <p className="flex flex-wrap items-center gap-2 text-sf-body-xs">{author}<span className="text-muted-foreground">{date}</span>{verified ? <Badge variant="outline">Verified purchase</Badge> : null}</p>
    </article>
  )
}

function StarInput({ value, onValueChange }: { value: number; onValueChange: (value: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" role="radio" aria-checked={star === value} aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`} onClick={() => onValueChange(star)} className="flex size-10 cursor-pointer items-center justify-center rounded-sf-button outline-none focus-visible:shadow-focus">
          <StarIcon filled={star <= value} className="size-6" />
        </button>
      ))}
    </div>
  )
}

function ReviewDialog({ defaultOpen }: { defaultOpen?: boolean }) {
  const [rating, setRating] = React.useState(4)
  return (
    <Dialog defaultOpen={defaultOpen}>
      <Dialog.Trigger asChild><Button variant="outline">Write a review</Button></Dialog.Trigger>
      <Dialog.Content size="sm" closeLabel="Close">
        <Dialog.Header><Dialog.Title>Write a review</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <div className="flex items-center gap-3">
            <img src={photos.beansInHand} alt="" className="h-14 w-12 rounded-sf-field object-cover" />
            <p className="flex flex-col text-sf-body">Huila Pink Bourbon<span className="text-sf-body-sm text-muted-foreground">250 g, Whole bean</span></p>
          </div>
          <div className="flex flex-col gap-1"><span className="text-sf-body-sm">Your rating</span><StarInput value={rating} onValueChange={setRating} /></div>
          <Input.Field label="Title"><Input defaultValue="Berries in a cup" /></Input.Field>
          <Input.Field label="Your review" required>
            <textarea defaultValue="Bright and clean, sweet like panela." className="min-h-24 w-full rounded-sf-field border border-input bg-background px-4 py-2.5 text-sf-body-lg text-foreground lg:text-sf-body outline-none transition-colors hover:border-muted-foreground focus-visible:border-foreground focus-visible:shadow-focus" />
          </Input.Field>
          <Input.Field label="Name" helper="Shown next to your review"><Input defaultValue="Marta K." autoComplete="given-name" /></Input.Field>
        </Dialog.Body>
        <Dialog.Footer className="border-t-0 sm:justify-stretch">
          <Dialog.Close asChild><Button size="lg" variant="outline">Cancel</Button></Dialog.Close>
          <Button size="lg" className="flex-1" data-dialog-primary>Submit</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}

function ReviewsSection({ empty }: { empty?: boolean }) {
  return (
    <main className="mx-auto flex max-w-sf flex-col gap-6 px-sf-gutter-sm py-10 sm:px-sf-gutter-md">
      <h2 className="text-sf-title lg:text-sf-display-s">Reviews</h2>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-16">
        <RatingSummary empty={empty} action={<ReviewDialog />} />
        {empty ? null : (
          <div className="flex flex-1 flex-col items-start gap-3 [&>article]:w-full">
            <ReviewCard rating={5} title="Berries in a cup" text="Bright and clean, sweet like panela. It holds up both as a pour-over and as a batch brew." author="Marta K." date="12 Oct 2026" verified />
            <ReviewCard rating={4} title="Good, a bit light for espresso" text="Lovely as a filter coffee. For espresso I would pick a darker roast." author="Tomek W." date="3 Oct 2026" />
            <Button variant="outline">Show more reviews</Button>
          </div>
        )}
      </div>
    </main>
  )
}

export const Reviews: Story = { render: () => <ReviewsSection /> }
export const NoReviews: Story = { name: 'Reviews, none yet', render: () => <ReviewsSection empty /> }
export const WriteReview: Story = { name: 'Write a review', render: () => <div className="p-8"><ReviewDialog defaultOpen /></div> }

export const SignIn: Story = {
  name: 'Sign in',
  render: () => (
    <div className="p-8">
      <Sheet defaultOpen>
        <Sheet.Trigger asChild><Button variant="outline">Sign in</Button></Sheet.Trigger>
        <Sheet.Content side="right" closeLabel="Close" className="sm:bottom-auto">
          <Sheet.Header><Sheet.Title>Sign in</Sheet.Title></Sheet.Header>
          <Sheet.Body className="pb-6">
            <Input.Field label="Email"><Input type="email" defaultValue="ania@example.com" autoComplete="email" /></Input.Field>
            <Input.Field label="Password"><Input type="password" placeholder="Enter your password" autoComplete="current-password" /></Input.Field>
            <a href="#forgot" className="self-start rounded-sf-badge text-sf-body-sm underline underline-offset-4 outline-none focus-visible:shadow-focus">Forgot password</a>
            <Button size="lg" fullWidth>Sign in</Button>
            <Button size="lg" variant="outline" fullWidth>Create account</Button>
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>
    </div>
  ),
}

function FavouritesPage({ empty }: { empty?: boolean }) {
  return (
    <main className="pb-12">
      <div className="flex flex-col gap-5 px-sf-gutter-sm pb-5 pt-6 sm:px-sf-gutter-md">
        <h1 className="text-sf-display-s lg:text-sf-display-l">Favourites</h1>
        {empty ? (
          <section className="flex flex-col items-start gap-5 py-10">
            <h2 className="text-sf-title lg:text-sf-display-m">Nothing saved yet</h2>
            <Button size="lg">Shop coffee</Button>
          </section>
        ) : (
          <div className="flex items-center justify-between gap-3"><p className="text-sf-body text-muted-foreground">4 products</p><Button>Add all to cart</Button></div>
        )}
      </div>
      {empty ? null : <ProductGrid products={sampleProducts.map((product) => ({ ...product, favourite: true }))} label="Favourites" />}
    </main>
  )
}

export const Favourites: Story = { render: () => <FavouritesPage /> }
export const FavouritesEmpty: Story = { name: 'Favourites, empty', render: () => <FavouritesPage empty /> }
