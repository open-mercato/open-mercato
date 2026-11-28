import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from '../primitives/button'
import { ChevronRightIcon } from '../lib/icons'
import { ProductGrid, photos, sampleProducts, type TileProduct } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront), drawn on the DS library pages
 * "Home and content [E-commerce]" and "Templates [E-commerce]". Nothing in this file is exported.
 * Layout: media runs to the page edges, text stays in the padded container.
 */
const meta = {
  title: 'Patterns/Home and content',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

const moreProducts: TileProduct[] = [
  { name: 'Sugarcane Decaf', subtitle: 'Colombia, caramel', photo: photos.paperBagAndCup, rating: [4.5, 47], badge: ['Sold out', 'sold-out'], soldOut: true, price: { price: '119,00 zł' } },
  { name: 'Paper filters V60', subtitle: '100 pcs', photo: photos.dripBag, rating: [4.9, 530], price: { price: '24,00 zł' } },
  { name: 'Hario V60 dripper', subtitle: 'Ceramic, size 02', photo: photos.pourOver, rating: [4.9, 412], price: { price: '119,00 zł' } },
  { name: 'Nyamasheke', subtitle: 'Rwanda, natural, plum', photo: photos.pourIntoCup, price: { price: '129,00 zł' } },
]

/** Full-bleed photo with the title in it; the site header sits on top of the photo (see Patterns/Navigation). */
function Hero() {
  return (
    <section className="relative flex h-140 flex-col justify-end lg:h-170">
      <img src={photos.pourIntoCup} alt="" className="absolute inset-0 size-full object-cover" />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-foreground/45 via-transparent via-30% to-transparent" />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-foreground/65 to-transparent to-55%" />
      <div className="relative flex items-end justify-between gap-10 px-sf-gutter-sm pb-6 text-primary-foreground sm:px-sf-gutter-md lg:pb-10">
        <div className="flex max-w-190 flex-col items-start gap-5 lg:gap-6">
          <h1 className="text-sf-display-s lg:text-sf-display-xl">Coffee roasted on Tuesday, with you by Friday</h1>
          <Button size="lg" variant="outline">Shop coffee</Button>
        </div>
        <a href="#roast" className="hidden rounded-sf-badge text-sf-body underline underline-offset-4 outline-none focus-visible:shadow-focus lg:block">How we roast</a>
      </div>
    </section>
  )
}

function SectionHeader({ title, link }: { title: string; link?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 px-sf-gutter-sm pb-3 pt-8 sm:px-sf-gutter-md lg:pb-5 lg:pt-14">
      <h2 className="text-sf-title lg:text-sf-display-s">{title}</h2>
      {link ? <a href="#all" className="flex items-center gap-1 rounded-sf-badge text-sf-body underline underline-offset-4 outline-none focus-visible:shadow-focus [&_svg]:size-4">{link}<ChevronRightIcon /></a> : null}
    </div>
  )
}

function FeatureBand() {
  return (
    <section className="flex flex-col lg:h-105 lg:flex-row">
      <div className="order-2 flex flex-1 flex-col items-start justify-between gap-5 bg-primary px-sf-gutter-sm pb-7 pt-6 text-primary-foreground sm:px-sf-gutter-md lg:order-1 lg:py-10">
        <h2 className="max-w-130 text-sf-title lg:text-sf-display-m">Subscribe and save 10% on every bag</h2>
        <Button size="lg" variant="outline">Start a subscription</Button>
      </div>
      <img src={photos.pourOver} alt="" className="order-1 h-65 w-full object-cover lg:order-2 lg:h-full lg:w-1/2" />
    </section>
  )
}

function StoryBlock() {
  return (
    <section className="flex flex-col gap-5 px-sf-gutter-sm pb-12 pt-10 sm:px-sf-gutter-md lg:flex-row lg:gap-16 lg:pb-22 lg:pt-18">
      <h2 className="text-sf-title lg:w-162 lg:text-sf-display-m">Roasted in Kraków since 2014</h2>
      <div className="flex flex-1 flex-col items-start gap-5">
        <p className="text-sf-body text-muted-foreground lg:text-sf-body-lg">We buy from eleven farms we visit ourselves and roast in small batches.</p>
        <Button size="lg" variant="outline">Our story</Button>
      </div>
    </section>
  )
}

function Home() {
  return (
    <main>
      <Hero />
      <SectionHeader title="Fresh this week" link="See all" />
      <ProductGrid products={[...sampleProducts, ...moreProducts]} label="Fresh this week" />
      <FeatureBand />
      <StoryBlock />
    </main>
  )
}

export const HomePage: Story = { name: 'Home', render: () => <Home /> }
export const HomePhone: Story = { name: 'Home, phone', parameters: { viewport: { defaultViewport: 'phone' } }, render: () => <Home /> }

export const NotFound: Story = {
  name: 'Page not found',
  render: () => (
    <main className="pb-12">
      <section className="flex flex-col items-start gap-5 px-sf-gutter-sm py-16 sm:px-sf-gutter-md">
        <h1 className="text-sf-title lg:text-sf-display-m">Page not found</h1>
        <Button size="lg">Back to shop</Button>
      </section>
      <SectionHeader title="More to explore" />
      <ProductGrid products={sampleProducts} label="More to explore" />
    </main>
  ),
}
