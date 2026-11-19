import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const cardVariants = cva('flex flex-col rounded-sf-card text-card-foreground', {
  variants: {
    surface: {
      white: 'border border-border bg-card',
      alt: 'bg-sf-surface',
      tile: 'bg-sf-surface',
    },
    padding: {
      none: '',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
    interactive: {
      true: 'cursor-pointer outline-none transition-colors hover:border-muted-foreground focus-visible:shadow-focus',
    },
  },
  defaultVariants: { surface: 'white', padding: 'md' },
})

export type CardProps = React.ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof cardVariants> & {
    /** Rename the element, for example `a` or `article`. */
    asChild?: boolean
    /** Pastel tile fill from the Figma v2 set; only applies with `surface="tile"`. */
    tile?: 'warm' | 'fresh' | 'bold' | 'cool' | 'soft' | 'calm' | 'bright'
  }

const tileClass = {
  warm: 'bg-sf-tile-warm',
  fresh: 'bg-sf-tile-fresh',
  bold: 'bg-sf-tile-bold',
  cool: 'bg-sf-tile-cool',
  soft: 'bg-sf-tile-soft',
  calm: 'bg-sf-tile-calm',
  bright: 'bg-sf-tile-bright',
}

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, surface, padding, interactive, asChild, tile, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      data-slot="card"
      className={cn(cardVariants({ surface, padding, interactive }), surface === 'tile' && tile && tileClass[tile], className)}
      {...props}
    />
  )
})

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} data-slot="card-header" className={cn('flex items-start justify-between gap-4', className)} {...props} />
})

const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<'h3'>>(function CardTitle({ className, ...props }, ref) {
  return <h3 ref={ref} data-slot="card-title" className={cn('text-sf-title-sm text-foreground lg:text-sf-title', className)} {...props} />
})

const CardBody = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function CardBody({ className, ...props }, ref) {
  return <div ref={ref} data-slot="card-body" className={cn('flex flex-col gap-3', className)} {...props} />
})

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function CardFooter({ className, ...props }, ref) {
  return <div ref={ref} data-slot="card-footer" className={cn('flex flex-wrap items-center gap-3', className)} {...props} />
})

export const Card = Object.assign(CardRoot, { Header: CardHeader, Title: CardTitle, Body: CardBody, Footer: CardFooter })
export { cardVariants }
