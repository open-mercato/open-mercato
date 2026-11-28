import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Accordion } from '../primitives/accordion'
import { AspectRatio } from '../primitives/aspect-ratio'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { RadioGroup } from '../primitives/radio-group'
import { Alert } from '../primitives/alert'
import { Toast } from '../primitives/toast'
import { CheckIcon } from '../lib/icons'
import { Favourite, Price, ProductGrid, Rating, TruckIcon, photos, sampleProducts } from '../../.storybook/commerce'

const meta = {
  title: 'Patterns/Product page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

function OptionGroup({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sf-body-sm">{label}</p>
      {children}
    </div>
  )
}

function BuyBox({ b2b }: { b2b?: boolean }) {
  const [quantity, setQuantity] = React.useState(b2b ? 12 : 1)
  const [size, setSize] = React.useState(b2b ? '6x1' : '250')
  const [grind, setGrind] = React.useState('whole')
  const { toast } = Toast.useToast()
  const name = b2b ? 'Espresso Classico' : 'Huila Pink Bourbon'
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-sf-display-s">{name}</h1>
        <p className="text-sf-body-lg text-muted-foreground">{b2b ? 'House blend, chocolate and hazelnut' : 'Colombia, red fruit'}</p>
        <Rating score={4.8} count={128} size="lg" />
      </div>
      {b2b ? <Price size="lg" price="74,00 zł" net /> : <Price size="lg" price="99,00 zł" original="129,00 zł" lowestPrior="119,00 zł" />}
      <OptionGroup label={b2b ? 'Pack' : 'Size'}>
        {b2b ? (
          <RadioGroup variant="chip" value={size} onValueChange={setSize} aria-label="Pack">
            <RadioGroup.Item value="6x1" label="6 x 1 kg" />
            <RadioGroup.Item value="6x250" label="6 x 250 g" />
          </RadioGroup>
        ) : (
          <RadioGroup variant="chip" value={size} onValueChange={setSize} aria-label="Size">
            <RadioGroup.Item value="250" label="250 g" />
            <RadioGroup.Item value="1000" label="1 kg" />
          </RadioGroup>
        )}
      </OptionGroup>
      <OptionGroup label="Grind">
        <RadioGroup variant="chip" value={grind} onValueChange={setGrind} aria-label="Grind">
          <RadioGroup.Item value="whole" label="Whole bean" />
          <RadioGroup.Item value="filter" label="Filter" />
          <RadioGroup.Item value="espresso" label="Espresso" unavailable description="Out of stock" />
        </RadioGroup>
      </OptionGroup>
      {b2b ? (
        <div className="overflow-hidden rounded-sf-field border border-border text-sf-body-sm">
          <div className="flex items-center justify-between bg-sf-surface px-4 py-3"><span>Buy more, pay less</span><span className="text-sf-body-xs text-muted-foreground">Price per carton, excl. VAT</span></div>
          {[['1 to 5 cartons', '84,00 zł'], ['6 to 11 cartons', '79,00 zł'], ['12 or more cartons', '74,00 zł', true]].map(([range, price, current]) => (
            <div key={String(range)} className="flex items-center gap-3 border-t border-border px-4 py-3">
              <span className="flex-1">{range}</span>
              {current ? <Badge variant="default">Your tier</Badge> : null}
              <span>{price}</span>
            </div>
          ))}
        </div>
      ) : (
        <RadioGroup variant="card" defaultValue="once" aria-label="Purchase">
          <RadioGroup.Item value="once" label="One-time purchase" trailing="99,00 zł" />
          <RadioGroup.Item value="subscribe" label="Subscribe and save 10%" description="Every 2 weeks, skip or cancel any time" trailing="89,00 zł" />
        </RadioGroup>
      )}
      {b2b ? <Alert status="neutral">Sold in multiples of 6 cartons. Minimum order 6.</Alert> : null}
      <div className="flex gap-2">
        <Input.Stepper size="lg" value={quantity} onValueChange={setQuantity} min={b2b ? 6 : 1} step={b2b ? 6 : 1} max={240} labels={{ decrease: 'Decrease quantity', increase: 'Increase quantity', value: 'Quantity' }} />
        <Button size="lg" className="flex-1" onClick={() => toast({ title: `${name} added to your cart`, status: 'success', action: { label: 'View cart', onClick: () => {} } })}>Add to cart</Button>
        {b2b ? <Button size="lg" variant="outline">Add to list</Button> : <Favourite name={name} size="icon" className="size-sf-lg" />}
      </div>
      <ul className="flex flex-col gap-2 text-sf-body-sm [&_svg]:size-4.5 [&_svg]:shrink-0">
        <li className="flex items-center gap-2"><CheckIcon />{b2b ? 'In stock, delivered on your Thursday route' : 'In stock, ships within 1 day'}</li>
        {b2b ? <li className="flex items-center gap-2"><TruckIcon />Invoice, 14 days payment terms</li> : null}
      </ul>
      <Accordion type="single" collapsible defaultValue="about">
        <Accordion.Item value="about"><Accordion.Trigger>About this coffee</Accordion.Trigger><Accordion.Content>Pink Bourbon from Huila, washed and roasted light for filter.</Accordion.Content></Accordion.Item>
        <Accordion.Item value="brew"><Accordion.Trigger>Brewing guide</Accordion.Trigger><Accordion.Content>15 g to 250 g of water at 94 °C.</Accordion.Content></Accordion.Item>
        <Accordion.Item value="delivery"><Accordion.Trigger>Delivery and returns</Accordion.Trigger><Accordion.Content>Roasted on Tuesday, shipped the same day.</Accordion.Content></Accordion.Item>
      </Accordion>
    </div>
  )
}

const gallery = [photos.beansInHand, photos.beansTopDown, photos.beansInBag, photos.pourIntoCup]

function Gallery() {
  return (
    <>
      <ul aria-label="Product photos" className="hidden grid-cols-2 gap-0.5 lg:grid">
        {gallery.map((photo, index) => (
          <li key={photo}><AspectRatio ratio={4 / 5} className="bg-sf-surface"><img src={photo} alt={index === 0 ? 'Huila Pink Bourbon, open bag of beans' : ''} className="size-full object-cover" /></AspectRatio></li>
        ))}
      </ul>
      <div className="relative lg:hidden">
        <AspectRatio ratio={390 / 460} className="bg-sf-surface"><img src={gallery[0]} alt="Huila Pink Bourbon, open bag of beans" className="size-full object-cover" /></AspectRatio>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-4 mx-auto flex w-fit gap-1.5 rounded-sf-button bg-sf-surface px-3 py-2">
          {gallery.map((photo, index) => <span key={photo} className={`size-1.5 rounded-full ${index === 0 ? 'bg-foreground' : 'bg-border'}`} />)}
        </div>
      </div>
    </>
  )
}

function Page({ b2b }: { b2b?: boolean }) {
  return (
    <>
      <main className="grid lg:grid-cols-[2fr_1fr] lg:items-start">
        <Gallery />
        <div className="px-sf-gutter-sm py-6 lg:sticky lg:top-0 lg:p-10"><BuyBox b2b={b2b} /></div>
      </main>
      <section aria-labelledby="related" className="pt-10 lg:pt-18">
        <h2 id="related" className="px-sf-gutter-sm pb-3 text-sf-title sm:px-sf-gutter-md lg:pb-5 lg:text-sf-display-s">Goes well with</h2>
        <ProductGrid products={sampleProducts} label="Goes well with" />
      </section>
    </>
  )
}

export const Retail: Story = { render: () => <Page /> }
export const B2BTiers: Story = { name: 'B2B, tier prices and quantity rule', render: () => <Page b2b /> }
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'phone' } }, render: () => <Page /> }
