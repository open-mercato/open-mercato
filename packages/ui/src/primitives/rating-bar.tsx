"use client"

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Heart, Star } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ratingEmojiImages } from '../assets/rating-emoji'
import { Button } from './button'
import { RadioGroup } from './radio'

export type RatingBarProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadioGroup>,
  'value' | 'defaultValue' | 'onValueChange' | 'onChange' | 'orientation' | 'children'
> & {
  value: number
  onChange: (value: number) => void
  variant?: 'emoji' | 'number' | 'star' | 'heart'
  'aria-label': string
}

export const RatingBar = React.forwardRef<HTMLDivElement, RatingBarProps>(
  ({ className, value, onChange, variant = 'emoji', disabled, ...props }, ref) => {
    const t = useT()
    const Glyph = variant === 'heart' ? Heart : Star
    return (
      <RadioGroup
        ref={ref}
        value={value > 0 ? String(value) : ''}
        onValueChange={(next) => onChange(Number(next))}
        orientation="horizontal"
        disabled={disabled}
        data-slot="rating-bar"
        className={cn('h-9 w-80 max-w-full flex-row gap-0 rounded-none border border-border bg-background', className)}
        {...props}
      >
        {Array.from({ length: 5 }, (_, index) => (
          <Button
            key={index}
            type="button"
            variant="ghost"
            asChild
            aria-label={t('ui.rating.item.ariaLabel', '{position} of {max}', { position: index + 1, max: 5 })}
            className="h-full min-w-0 flex-1 rounded-none border-r border-border px-1 py-0 text-muted-foreground last:border-r-0 hover:bg-muted hover:text-foreground focus-visible:z-10 data-[state=checked]:bg-muted data-[state=checked]:text-foreground disabled:opacity-60 dark:hover:bg-muted"
          >
            <RadioGroupPrimitive.Item value={String(index + 1)}>
              {variant === 'number' ? index + 1 : variant === 'emoji' ? (
                <img src={ratingEmojiImages[index]} alt="" aria-hidden="true" className="size-5" />
              ) : (
                <Glyph
                  aria-hidden="true"
                  className={cn('size-5', value > 0
                    ? variant === 'heart' ? 'fill-status-error-icon text-status-error-icon' : 'fill-status-warning-icon text-status-warning-icon'
                    : 'fill-transparent text-muted-foreground/30')}
                />
              )}
            </RadioGroupPrimitive.Item>
          </Button>
        ))}
      </RadioGroup>
    )
  },
)
RatingBar.displayName = 'RatingBar'
