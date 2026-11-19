import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
import { Checkbox } from '../primitives/checkbox'
import { Combobox } from '../primitives/combobox'
import { Input } from '../primitives/input'
import { RadioGroup } from '../primitives/radio-group'
import { Select } from '../primitives/select'
import { Separator } from '../primitives/separator'
import { Sheet } from '../primitives/sheet'
import { AspectRatio } from '../primitives/aspect-ratio'
import { CheckIcon, TrashIcon, XIcon } from '../lib/icons'
import { TruckIcon, photos } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront), drawn on the DS library page
 * "Cart and checkout [E-commerce]". Nothing in this file is exported.
 */
const meta = {
  title: 'Patterns/Cart and checkout',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

function Glyph({ children }: React.PropsWithChildren) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
}
const TagIcon = () => <Glyph><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" /></Glyph>
const LockIcon = () => <Glyph><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Glyph>
const PackageIcon = () => <Glyph><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><polyline points="3.29 7 12 12 20.71 7" /><path d="m7.5 4.27 9 5.15" /></Glyph>
const CircleCheck = () => <Glyph><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Glyph>

type Line = { name: string; variant: string; price: string; quantity: number; photo: string; notice?: [string, 'low-stock' | 'sold-out']; unavailable?: boolean }

const lines: Line[] = [
  { name: 'Guji Hambela', variant: '250 g, Whole bean', price: '238,00 zł', quantity: 2, photo: photos.greyBag, notice: ['Price changed from 129,00 zł', 'low-stock'] },
  { name: 'Paper filters V60', variant: '100 pcs', price: '24,00 zł', quantity: 1, photo: photos.dripBag },
  { name: 'Hario V60 dripper', variant: 'Ceramic, size 02', price: '119,00 zł', quantity: 1, photo: photos.pourOver },
]

function FreeDelivery({ remaining }: { remaining?: string }) {
  return (
    <div className="flex flex-col gap-2 text-sf-body-sm [&_svg]:size-4.5 [&_svg]:shrink-0">
      <p className="flex items-center gap-2">{remaining ? <TruckIcon /> : <CheckIcon />}{remaining ? `Add ${remaining} more for free delivery` : 'Free delivery unlocked'}</p>
      {remaining ? <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-border"><div className="h-full w-3/4 bg-foreground" /></div> : null}
    </div>
  )
}

function Summary({ checkout }: { checkout?: boolean }) {
  return (
    <Card surface="alt" padding="none" className="gap-4 rounded-sf-sheet p-7 lg:sticky lg:top-6 lg:self-start">
      <h2 className="text-sf-title-sm lg:text-sf-title">{checkout ? 'Your order' : 'Summary'}</h2>
      {checkout ? (
        <ul className="flex flex-col gap-3">
          {lines.map((line) => (
            <li key={line.name} className="flex items-center gap-3 text-sf-body-sm">
              <img src={line.photo} alt="" className="h-14 w-12 rounded-sf-field object-cover" />
              <span className="flex-1">{line.name}</span><span>{line.price}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="flex flex-col gap-2.5 text-sf-body-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>381,00 zł</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="text-sf-sale">−47,60 zł</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd>Free</dd></div>
      </dl>
      <Separator />
      <div className="flex items-baseline justify-between"><span className="text-sf-body">Total</span><span className="text-sf-title">333,40 zł</span></div>
      <p className="-mt-2 text-sf-body-xs text-muted-foreground">Including 24,93 zł VAT</p>
      {checkout ? null : (
        <>
          <Button size="lg" fullWidth>Checkout</Button>
          <p className="flex items-center justify-center gap-1.5 text-sf-body-xs text-muted-foreground [&_svg]:size-3.5"><LockIcon />BLIK, Apple Pay, card</p>
        </>
      )}
    </Card>
  )
}

function CartLine({ line, compact }: { line: Line; compact?: boolean }) {
  const [value, setValue] = React.useState(line.quantity)
  return (
    <div className="flex gap-4 border-b border-border pb-5">
      <AspectRatio ratio="product" className={`shrink-0 overflow-hidden rounded-sf-field bg-sf-surface ${compact ? 'w-20' : 'w-24'}`}>
        <img src={line.photo} alt="" className={`size-full object-cover ${line.unavailable ? 'opacity-60' : ''}`} />
      </AspectRatio>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3 text-sf-body"><span>{line.name}</span>{line.unavailable ? null : <span>{line.price}</span>}</div>
        <span className="text-sf-body-sm text-muted-foreground">{line.variant}</span>
        {line.notice ? <Badge variant={line.notice[1]} className="self-start">{line.notice[0]}</Badge> : null}
        <div className="flex items-center justify-between pt-1.5">
          {line.unavailable ? <span /> : <Input.Stepper value={value} onValueChange={setValue} min={1} removeAtMin removeIcon={<TrashIcon />} labels={{ decrease: `Decrease quantity of ${line.name}`, increase: `Increase quantity of ${line.name}`, value: `Quantity of ${line.name}` }} />}
          <Button variant="link" size="sm" leadingIcon={<TrashIcon className="size-4" />} className="text-muted-foreground">Remove<span className="sr-only"> {line.name}</span></Button>
        </div>
      </div>
    </div>
  )
}

function PromoCode() {
  const [applied, setApplied] = React.useState(true)
  return applied ? (
    <div className="flex h-10 w-fit items-center gap-2 rounded-sf-button bg-sf-surface pl-3 pr-1 text-sf-body-sm [&>svg]:size-4">
      <TagIcon />COFFEEWEEK, −20% on filter coffee
      <button type="button" aria-label="Remove code COFFEEWEEK" onClick={() => setApplied(false)} className="flex size-8 cursor-pointer items-center justify-center rounded-sf-badge outline-none focus-visible:shadow-focus [&_svg]:size-3.5"><XIcon /></button>
    </div>
  ) : (
    <div className="flex items-end gap-2">
      <Input.Field label="Promo code" className="flex-1"><Input defaultValue="COFFEEWEEK" /></Input.Field>
      <Button variant="outline" onClick={() => setApplied(true)}>Apply</Button>
    </div>
  )
}

export const Cart: Story = {
  render: () => (
    <main className="mx-auto flex max-w-sf flex-col gap-8 px-sf-gutter-sm py-8 sm:px-sf-gutter-md lg:px-sf-gutter-lg">
      <div className="flex items-baseline gap-4"><h1 className="text-sf-display-s lg:text-sf-display-l">Your cart</h1><span className="text-sf-body text-muted-foreground">4 items</span></div>
      <div className="grid gap-10 lg:grid-cols-[1fr_26rem]">
        <div className="flex flex-col gap-5">
          {lines.map((line) => <CartLine key={line.name} line={line} />)}
          <CartLine line={{ name: 'Sugarcane Decaf', variant: '250 g, Filter', price: '119,00 zł', quantity: 1, photo: photos.paperBagAndCup, notice: ['No longer available', 'sold-out'], unavailable: true }} />
          <PromoCode />
        </div>
        <Summary />
      </div>
    </main>
  ),
}

export const EmptyCart: Story = {
  name: 'Cart, empty',
  render: () => (
    <main className="mx-auto flex max-w-sf flex-col items-start gap-6 px-sf-gutter-sm py-16 sm:px-sf-gutter-md lg:px-sf-gutter-lg">
      <h1 className="text-sf-title lg:text-sf-display-m">Your cart is empty</h1>
      <Button size="lg">Shop coffee</Button>
    </main>
  ),
}

export const MiniCart: Story = {
  name: 'Mini cart',
  render: () => (
    <div className="p-8">
      <Sheet defaultOpen>
        <Sheet.Trigger asChild><Button variant="outline">Open cart</Button></Sheet.Trigger>
        <Sheet.Content side="right" closeLabel="Close cart">
          <Sheet.Header><Sheet.Title>Cart, 2 items</Sheet.Title></Sheet.Header>
          <Sheet.Body className="gap-5">
            <FreeDelivery remaining="38,00 zł" />
            {lines.slice(1).map((line) => <CartLine key={line.name} line={line} compact />)}
          </Sheet.Body>
          <Sheet.Footer>
            <div className="flex justify-between text-sf-body"><span>Subtotal</span><span>143,00 zł</span></div>
            <Button size="lg" fullWidth>Checkout</Button>
            <Button size="lg" variant="outline" fullWidth>View cart</Button>
          </Sheet.Footer>
        </Sheet.Content>
      </Sheet>
    </div>
  ),
}

function CompletedSection({ title, value }: { title: string; value: string }) {
  return (
    <section className="flex flex-col gap-1 rounded-sf-card bg-sf-surface px-6 py-5">
      <div className="flex items-center justify-between text-sf-body"><h2>{title}</h2><Button variant="link" size="sm">Edit<span className="sr-only"> {title}</span></Button></div>
      <p className="text-sf-body-sm text-muted-foreground">{value}</p>
    </section>
  )
}

function Address() {
  const [address, setAddress] = React.useState('Józefa 1')
  return (
    <Combobox label="Street and number" leadingIcon={false} value={address} onValueChange={setAddress} onSelect={(item) => setAddress(String(item.label))}
      items={address.length > 2 ? [{ id: 'a1', label: 'ul. Józefa 11, 31-056 Kraków' }, { id: 'a2', label: 'ul. Józefa 12, 31-056 Kraków' }] : []}
      footer={<button type="button">Enter address manually</button>} />
  )
}

export const CheckoutDelivery: Story = {
  name: 'Checkout, address and delivery',
  render: () => (
    <main className="mx-auto grid max-w-sf gap-10 px-sf-gutter-sm py-8 sm:px-sf-gutter-md lg:grid-cols-[1fr_26rem] lg:px-sf-gutter-lg">
      <div className="flex max-w-2xl flex-col gap-6">
        <h1 className="text-sf-display-s">Checkout</h1>
        <CompletedSection title="Contact" value="ola@example.com" />
        <section className="flex flex-col gap-5 rounded-sf-card border border-border px-6 py-5">
          <h2 className="text-sf-title-sm lg:text-sf-title">Delivery</h2>
          <div className="grid gap-3 grid-cols-2">
            <Input.Field label="Country" required className="col-span-2"><Select defaultValue="pl"><Select.Trigger><Select.Value /></Select.Trigger><Select.Content><Select.Item value="pl">Poland</Select.Item><Select.Item value="de">Germany</Select.Item></Select.Content></Select></Input.Field>
            <Input.Field label="First name" required><Input defaultValue="Ola" autoComplete="given-name" /></Input.Field>
            <Input.Field label="Last name" required><Input defaultValue="Nowak" autoComplete="family-name" /></Input.Field>
            <div className="col-span-2"><Address /></div>
            <Input.Field label="Postcode" required error="Enter a postcode in the format 00-000"><Input defaultValue="31-05" inputMode="numeric" autoComplete="postal-code" /></Input.Field>
            <Input.Field label="City" required><Input defaultValue="Kraków" autoComplete="address-level2" /></Input.Field>
            <Input.Field label="Phone" helper="Only for delivery issues" className="col-span-2"><Input type="tel" defaultValue="+48 600 100 200" autoComplete="tel" /></Input.Field>
          </div>
          <Checkbox label="Save this address for next time" defaultChecked />
          <RadioGroup variant="card" defaultValue="inpost" aria-label="Delivery method">
            <RadioGroup.Item value="inpost" label="InPost parcel locker" description="1 to 2 working days" trailing="12,99 zł" />
            <RadioGroup.Item value="dpd" label="DPD courier" description="Next working day" trailing="16,99 zł" />
            <RadioGroup.Item value="pickup" label="Pickup at the roastery" description="Kraków, Podgórze" trailing="Free" />
          </RadioGroup>
          <Button size="lg" className="self-start">Continue to payment</Button>
        </section>
        <section className="rounded-sf-card bg-sf-surface px-6 py-5 text-sf-body text-muted-foreground"><h2>Payment</h2></section>
      </div>
      <Summary checkout />
    </main>
  ),
}

export const Confirmation: Story = {
  name: 'Order confirmation',
  render: () => (
    <main className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-sf-gutter-sm py-12 sm:px-sf-gutter-md">
      <h1 className="text-sf-display-s lg:text-sf-display-l">Thank you, Ania</h1>
      <p className="text-sf-body-lg text-muted-foreground">Order 10482 is confirmed. We sent the details to ania@example.com.</p>
      <section className="flex w-full flex-col gap-4 rounded-sf-card bg-sf-surface p-6">
        <h2 className="text-sf-title-sm lg:text-sf-title">What happens next</h2>
        <ul className="flex flex-col gap-3 text-sf-body [&_svg]:mt-0.5 [&_svg]:size-4.5 [&_svg]:shrink-0">
          <li className="flex gap-3"><PackageIcon />We pack your order on Tuesday, after roasting</li>
          <li className="flex gap-3"><TruckIcon />The carrier sends you a tracking link</li>
          <li className="flex gap-3"><CircleCheck />Rate the coffee once you have tried it</li>
        </ul>
      </section>
      <Button size="lg" variant="outline">Continue shopping</Button>
    </main>
  ),
}
