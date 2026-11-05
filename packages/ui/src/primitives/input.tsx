import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const inputWrapperVariants = cva(
  'inline-flex w-full items-center gap-2 rounded-md border border-input bg-background shadow-xs transition-colors focus-within:outline-none focus-within:shadow-focus focus-within:border-foreground hover:bg-muted/40 has-[input:disabled]:bg-bg-disabled has-[input:disabled]:border-border-disabled has-[input:disabled]:shadow-none has-[input:disabled]:hover:bg-bg-disabled has-[input:disabled]:[&>svg]:text-text-disabled has-[input:disabled]:[&>span[aria-hidden=true]]:text-text-disabled has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:focus-within:border-destructive',
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5',
        default: 'h-9 px-3',
        lg: 'h-10 rounded-lg px-3',
        32: 'h-8 gap-1.5 pl-2 pr-1.5 [&_svg]:size-5',
        36: 'h-9 gap-2 pl-2.5 pr-2 [&_svg]:size-5',
        40: 'h-10 gap-2 rounded-lg pl-3 pr-2.5 [&_svg]:size-5',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

const inputElementVariants = cva(
  'flex-1 min-w-0 bg-transparent border-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled disabled:placeholder:text-text-disabled',
  {
    variants: {
      size: {
        sm: 'text-sm',
        default: 'text-sm',
        lg: 'text-sm',
        32: 'text-sm leading-5',
        36: 'text-sm leading-5',
        40: 'text-sm leading-5',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> &
  VariantProps<typeof inputWrapperVariants> & {
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    leading?: React.ReactNode
    trailing?: React.ReactNode
    /** Optional className on the inner <input> element. */
    inputClassName?: string
  }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputClassName, type = 'text', size, leftIcon, rightIcon, leading, trailing, ...props }, ref) => {
    return (
      <div
        className={cn(inputWrapperVariants({ size }), className)}
        data-slot="input-wrapper"
      >
        {leading ? <span className="flex shrink-0 items-center" data-slot="input-leading">{leading}</span> : null}
        {leftIcon ? (
          <span
            className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          type={type}
          className={cn(inputElementVariants({ size }), inputClassName)}
          {...props}
        />
        {rightIcon ? (
          <span
            className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        ) : null}
        {trailing ? <span className="flex shrink-0 items-center" data-slot="input-trailing">{trailing}</span> : null}
      </div>
    )
  }
)

Input.displayName = 'Input'

export { inputWrapperVariants, inputElementVariants }
