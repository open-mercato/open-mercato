import * as React from 'react'
import { AspectRatio } from '../src/primitives/aspect-ratio'
import { Badge, type BadgeVariant } from '../src/primitives/badge'
import { Button } from '../src/primitives/button'
import { VisuallyHidden } from '../src/primitives/visually-hidden'
import { PlusIcon } from '../src/lib/icons'

/**
 * Story-only copies of the app compositions drawn on the DS library page "Product [E-commerce]":
 * Rating, Favourite, Price and Product Tile. The real ones live in apps/storefront (ADR-8).
 */

function Glyph({ children, filled, className }: React.PropsWithChildren<{ filled?: boolean; className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      {children}
    </svg>
  )
}

export const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <Glyph filled={filled}><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></Glyph>
)

export const StarIcon = ({ className, filled = true }: { className?: string; filled?: boolean }) => (
  <Glyph filled={filled} className={className}><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></Glyph>
)

export const TruckIcon = () => (
  <Glyph><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></Glyph>
)

export function Rating({ score, count, size = 'sm' }: { score?: number; count?: number; size?: 'sm' | 'lg' }) {
  const text = size === 'sm' ? 'text-sf-body-xs' : 'text-sf-body-sm'
  if (!score || !count) return <p className={`${text} text-muted-foreground`}>No reviews yet</p>
  return (
    <p className={`flex items-center gap-1.5 ${text}`}>
      <span className="flex gap-px" aria-hidden="true">
        {Array.from({ length: size === 'sm' ? 1 : 5 }, (_, index) => <StarIcon key={index} className={size === 'sm' ? 'size-3.5' : 'size-4'} />)}
      </span>
      <VisuallyHidden>Rated</VisuallyHidden>
      <span>{score.toFixed(1)}</span>
      <span className="text-muted-foreground">{size === 'sm' ? `(${count})` : `${count} reviews`}</span>
    </p>
  )
}

export function Favourite({ name, size = 'icon-sm', className, defaultActive = false }: { name: string; size?: 'icon-sm' | 'icon'; className?: string; defaultActive?: boolean }) {
  const [active, setActive] = React.useState(defaultActive)
  return (
    <Button variant="secondary" size={size} aria-pressed={active} aria-label={`Save ${name} to favourites`} className={className} onClick={() => setActive((value) => !value)}>
      <HeartIcon filled={active} />
    </Button>
  )
}

export type PriceProps = { price: string; original?: string; lowestPrior?: string; from?: boolean; net?: boolean; size?: 'default' | 'lg' }

export function Price({ price, original, lowestPrior, from, net, size = 'default' }: PriceProps) {
  const main = size === 'lg' ? 'text-sf-title' : 'text-sf-body'
  const small = size === 'lg' ? 'text-sf-body' : 'text-sf-body-sm'
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`flex flex-wrap items-baseline gap-x-2 ${main}`}>
        {original ? (
          <>
            <VisuallyHidden>Sale price</VisuallyHidden>
            <ins className="text-sf-sale no-underline">{price}</ins>
            <VisuallyHidden>Original price</VisuallyHidden>
            <del className={`${small} text-muted-foreground`}>{original}</del>
          </>
        ) : (
          <span>{from ? `From ${price}` : price}</span>
        )}
        {net ? <span className="text-sf-body-xs text-muted-foreground">excl. VAT</span> : null}
      </p>
      {original && lowestPrior ? <p className="text-sf-body-xs text-muted-foreground">Lowest price in the last 30 days: {lowestPrior}</p> : null}
    </div>
  )
}

export type TileProduct = {
  name: string
  subtitle: string
  photo: string
  price: PriceProps
  badge?: [string, BadgeVariant]
  rating?: [number, number]
  soldOut?: boolean
  favourite?: boolean
}

/** Edge-to-edge tile: square photo corners, name and price on one line from `lg`, stacked below it. */
export function ProductTile({ product }: { product: TileProduct }) {
  const { price } = product
  return (
    <article className="flex min-w-0 flex-col">
      <div className="relative">
        <a href="#product" tabIndex={-1} aria-hidden="true" className="group block overflow-hidden">
          <AspectRatio ratio={4 / 5} className="bg-sf-surface">
            <img src={product.photo} alt="" className={`size-full object-cover transition-transform duration-(--sf-motion-slow) group-hover:scale-105 ${product.soldOut ? 'opacity-60' : ''}`} />
          </AspectRatio>
        </a>
        {product.badge ? <Badge variant={product.badge[1]} className="pointer-events-none absolute left-3 top-3">{product.badge[0]}</Badge> : null}
        <Favourite name={product.name} defaultActive={product.favourite} className="absolute right-3 top-3" />
        {product.soldOut ? null : (
          <Button variant="secondary" size="icon-sm" aria-label={`Add ${product.name} to cart`} className="absolute bottom-3 right-3">
            <PlusIcon />
          </Button>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-3 pb-5 pt-3 lg:px-4 lg:pb-6">
        <div className="grid min-w-0 gap-x-3 gap-y-0.5 lg:grid-cols-[1fr_auto]">
          <h3 className="truncate text-sf-body lg:col-start-1 lg:row-start-1"><a href="#product" className="rounded-sf-badge outline-none hover:underline focus-visible:shadow-focus">{product.name}</a></h3>
          <p className="truncate text-sf-body-sm text-muted-foreground lg:col-start-1 lg:row-start-2">{product.subtitle}</p>
          <p className="flex items-baseline gap-2 text-sf-body lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex-col lg:items-end lg:gap-0.5">
            {price.original ? (
              <>
                <VisuallyHidden>Sale price</VisuallyHidden>
                <ins className="text-sf-sale no-underline">{price.price}</ins>
                <VisuallyHidden>Original price</VisuallyHidden>
                <del className="text-sf-body-sm text-muted-foreground">{price.original}</del>
              </>
            ) : (
              <span>{price.from ? `From ${price.price}` : price.price}</span>
            )}
          </p>
        </div>
        <Rating score={product.rating?.[0]} count={product.rating?.[1]} />
        {price.original && price.lowestPrior ? <p className="text-sf-body-xs text-muted-foreground">Lowest price in the last 30 days: {price.lowestPrior}</p> : null}
      </div>
    </article>
  )
}

/** Photos touch and the grid runs to the page edges; place it outside padded containers. */
export function ProductGrid({ products, label, children }: { products: TileProduct[]; label: string; children?: React.ReactNode }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-x-0.5 lg:grid-cols-4">
      {products.map((product) => <li key={product.name} className="min-w-0"><ProductTile product={product} /></li>)}
      {children}
    </ul>
  )
}

export const photos = {
  greyBag: '/photos/grey-bag.jpg',
  beansInHand: '/photos/beans-in-hand.jpg',
  beansTopDown: '/photos/beans-top-down.jpg',
  paperBagAndCup: '/photos/paper-bag-and-cup.jpg',
  beansInBag: '/photos/beans-in-bag.jpg',
  pourIntoCup: '/photos/pour-into-cup.jpg',
  dripBag: '/photos/drip-bag.jpg',
  pourOver: '/photos/pour-over.jpg',
}

export const sampleProducts: TileProduct[] = [
  { name: 'Guji Hambela', subtitle: 'Ethiopia, jasmine and peach', photo: photos.greyBag, rating: [4.9, 214], price: { price: '129,00 zł' } },
  { name: 'Huila Pink Bourbon', subtitle: 'Colombia, red fruit', photo: photos.beansInHand, rating: [4.8, 128], badge: ['−23%', 'promo'], price: { price: '99,00 zł', original: '129,00 zł', lowestPrior: '119,00 zł' } },
  { name: 'Nyeri AA', subtitle: 'Kenya, blackcurrant', photo: photos.beansTopDown, rating: [4.7, 96], badge: ['Low stock', 'low-stock'], price: { price: '139,00 zł' } },
  { name: 'Espresso Classico', subtitle: 'House blend, chocolate', photo: photos.beansInBag, rating: [4.6, 342], price: { price: '84,00 zł', from: true } },
]
