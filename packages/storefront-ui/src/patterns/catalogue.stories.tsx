import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Pagination } from '../primitives/pagination'
import { Select } from '../primitives/select'
import { Sheet } from '../primitives/sheet'
import { Separator } from '../primitives/separator'
import { Alert } from '../primitives/alert'
import { Breadcrumbs } from '../primitives/breadcrumbs'
import { CheckIcon, ChevronDownIcon } from '../lib/icons'
import { ProductTile, photos, type TileProduct } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront). They are documented here to prove the
 * DS library e-commerce section is reproducible from the 24 primitives and plain markup; nothing in this file is exported.
 */
const meta = {
  title: 'Patterns/Catalogue',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

const products: TileProduct[] = [
  { name: 'Guji Hambela', subtitle: 'Ethiopia, jasmine and peach', photo: photos.greyBag, rating: [4.9, 214], price: { price: '129,00 zł' } },
  { name: 'Huila Pink Bourbon', subtitle: 'Colombia, red fruit', photo: photos.beansInHand, rating: [4.8, 128], badge: ['−23%', 'promo'], price: { price: '99,00 zł', original: '129,00 zł', lowestPrior: '119,00 zł' } },
  { name: 'Nyeri AA', subtitle: 'Kenya, blackcurrant', photo: photos.beansTopDown, rating: [4.7, 96], badge: ['Low stock', 'low-stock'], price: { price: '139,00 zł' } },
  { name: 'Espresso Classico', subtitle: 'House blend, chocolate', photo: photos.beansInBag, rating: [4.6, 342], price: { price: '84,00 zł', from: true } },
  { name: 'Nyamasheke', subtitle: 'Rwanda, natural, plum', photo: photos.pourIntoCup, badge: ['New harvest', 'new'], price: { price: '129,00 zł' } },
  { name: 'Sugarcane Decaf', subtitle: 'Colombia, caramel', photo: photos.paperBagAndCup, rating: [4.5, 47], badge: ['Sold out', 'sold-out'], soldOut: true, price: { price: '119,00 zł' } },
  { name: 'Paper filters V60', subtitle: '100 pcs', photo: photos.dripBag, rating: [4.9, 530], price: { price: '24,00 zł' } },
  { name: 'Hario V60 dripper', subtitle: 'Ceramic, size 02', photo: photos.pourOver, rating: [4.9, 412], price: { price: '119,00 zł' } },
]

function FilterSheet({ trigger }: { trigger: React.ReactNode }) {
  return (
    <Sheet>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Content side="bottom" closeLabel="Close">
        <Sheet.Header><Sheet.Title>Filters</Sheet.Title></Sheet.Header>
        <Sheet.Body>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-3 text-sf-body-sm">Origin</legend>
            <Checkbox variant="chip" label="Ethiopia" trailing="12" defaultChecked />
            <Checkbox variant="chip" label="Kenya" trailing="8" />
            <Checkbox variant="chip" label="Colombia" trailing="9" />
            <Checkbox variant="chip" label="Honey" trailing="0" unavailable />
          </fieldset>
          <Separator />
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-3 text-sf-body-sm">Availability</legend>
            <Checkbox variant="chip" label="In stock" defaultChecked />
            <Checkbox variant="chip" label="Ships in 3 days" />
          </fieldset>
        </Sheet.Body>
        <Sheet.Footer className="sm:flex-row">
          <Button variant="outline" fullWidth>Clear all</Button>
          <Button fullWidth>Show 12 coffees</Button>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet>
  )
}

function FilterTrigger({ label, active }: { label: string; active?: boolean }) {
  return (
    <Button variant={active ? 'default' : 'outline'} leadingIcon={active ? <CheckIcon className="size-4" /> : undefined} trailingIcon={<ChevronDownIcon className="size-4" />} className="rounded-sf-chip">
      {label}
    </Button>
  )
}

function SortSelect({ priceSort = true }: { priceSort?: boolean }) {
  return (
    <div className="w-56">
      <Select defaultValue="recommended">
        <Select.Trigger aria-label="Sort by"><Select.Value /></Select.Trigger>
        <Select.Content>
          <Select.Item value="recommended">Recommended</Select.Item>
          <Select.Item value="rated">Best rated</Select.Item>
          <Select.Item value="newest">Newest</Select.Item>
          {priceSort ? <Select.Item value="price_asc">Price, low to high</Select.Item> : null}
          {priceSort ? <Select.Item value="price_desc">Price, high to low</Select.Item> : null}
        </Select.Content>
      </Select>
    </div>
  )
}

function CategoryHeader({ tone = 'plain' }: { tone?: 'plain' | 'primary' }) {
  const primary = tone === 'primary'
  return (
    <header className={primary ? 'bg-primary text-primary-foreground' : ''}>
      <div className="flex flex-col gap-4 px-sf-gutter-sm pb-6 pt-2 sm:px-sf-gutter-md lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:pb-10 lg:pt-6">
        <div className="flex flex-col gap-2">
          <Breadcrumbs label="Breadcrumb" backLabel="Back to" showCurrent={false} tone={primary ? 'inverse' : 'default'} items={[{ label: 'Home', href: '#' }, { label: 'Coffee' }]} />
          <h1 className="text-sf-display-s lg:text-sf-display-l">Coffee</h1>
        </div>
        <div className="flex flex-col gap-4 lg:max-w-140">
          <p className="text-sf-body-lg">Single origins and blends for filter and espresso.</p>
          <nav aria-label="Subcategories" className="flex flex-wrap gap-2">
            {[['Single origin', 24], ['Blends', 12], ['Decaf', 6]].map(([label, count]) => (
              <a key={label} href="#category" className={`inline-flex h-9 items-center gap-2 rounded-sf-chip border px-3.5 text-sf-body-sm outline-none focus-visible:shadow-focus ${primary ? 'border-primary-foreground hover:bg-sf-primary-soft' : 'border-border hover:bg-sf-surface'}`}>
                {label}<span className="text-sf-body-xs opacity-80">{count}</span>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}

function Listing({ empty, tone, sortUnavailable }: { empty?: boolean; tone?: 'plain' | 'primary'; sortUnavailable?: boolean }) {
  const [shown, setShown] = React.useState(8)
  const visible = products.slice(0, shown)
  return (
    <>
      <CategoryHeader tone={tone} />
      <div className="flex flex-col gap-5 px-sf-gutter-sm pb-5 pt-1 sm:px-sf-gutter-md">
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          <FilterTrigger label="Origin" />
          <FilterTrigger label="Roast" />
          <FilterTrigger label="Ethiopia" active />
          <FilterTrigger label="Price" />
          <Checkbox variant="chip" label="In stock" defaultChecked />
          <span className="ml-auto text-sf-body-xs text-muted-foreground">{empty ? '0 products' : '48 products'}</span>
          <SortSelect priceSort={!sortUnavailable} />
        </div>
        {sortUnavailable ? <Alert status="neutral">Sorting by price is not offered for this catalogue. Showing recommended order.</Alert> : null}
        {empty ? (
          <section className="flex flex-col gap-6 py-10" aria-labelledby="no-results">
            <h2 id="no-results" className="text-sf-title lg:text-sf-display-m">No products match these filters</h2>
            <div className="flex gap-2">
              <Button size="lg">Clear all</Button>
              <FilterSheet trigger={<Button size="lg" variant="outline">Edit filters</Button>} />
            </div>
          </section>
        ) : null}
      </div>
      {empty ? null : (
        <main>
          <ul className="grid grid-cols-2 gap-x-0.5 lg:grid-cols-4" aria-label="Products">
            {visible.slice(0, 4).map((product) => <li key={product.name} className="min-w-0"><ProductTile product={product} /></li>)}
            <li className="col-span-2 flex flex-col overflow-hidden lg:flex-row">
              <div className="order-2 flex flex-1 flex-col items-start justify-between gap-4 bg-primary p-5 text-primary-foreground lg:order-1 lg:p-7">
                <h3 className="text-sf-title lg:text-sf-display-s">Roasted on Tuesday, with you by Friday</h3>
                <Button variant="outline">How we roast</Button>
              </div>
              <img src={photos.pourOver} alt="" className="order-1 h-50 w-full object-cover lg:order-2 lg:h-auto lg:w-1/2" />
            </li>
            {visible.slice(4).map((product) => <li key={product.name} className="min-w-0"><ProductTile product={product} /></li>)}
          </ul>
          <Pagination.LoadMore className="px-sf-gutter-sm pb-18 pt-10" shown={shown} total={48} labels={{ showing: `Showing ${shown} of 48`, loadMore: 'Load more' }} onLoadMore={() => setShown((value) => value + 8)} />
        </main>
      )}
      <div className="pointer-events-none sticky bottom-4 z-sticky flex justify-center lg:hidden">
        <div className="pointer-events-auto flex h-12 items-center rounded-sf-card bg-primary px-2 text-primary-foreground shadow-lg">
          <FilterSheet trigger={<button type="button" className="flex h-10 cursor-pointer items-center gap-2 rounded-sf-button px-4 text-sf-body-sm outline-none focus-visible:shadow-focus">Filters<span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground text-sf-body-xs text-primary">2</span></button>} />
          <span aria-hidden="true" className="h-6 w-px bg-sf-primary-soft" />
          <button type="button" className="flex h-10 cursor-pointer items-center gap-2 rounded-sf-button px-4 text-sf-body-sm outline-none focus-visible:shadow-focus">Recommended<ChevronDownIcon className="size-4" /></button>
        </div>
      </div>
    </>
  )
}

export const CategoryListing: Story = { render: () => <Listing /> }
export const PrimaryHeader: Story = { name: 'Listing, header on the primary colour', render: () => <Listing tone="primary" /> }
export const PriceSortNotOffered: Story = { name: 'Listing, price sort not offered (B2B)', render: () => <Listing sortUnavailable /> }
export const NoResults: Story = { name: 'Listing, no results', render: () => <Listing empty /> }
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'phone' } }, render: () => <Listing /> }
