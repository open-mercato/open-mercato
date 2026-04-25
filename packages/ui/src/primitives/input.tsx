import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const inputWrapperVariants = cva(
  'inline-flex w-full items-center gap-2 rounded-md border border-input bg-background shadow-xs transition-colors focus-within:outline-none focus-within:shadow-focus focus-within:border-foreground hover:bg-muted/40 has-[input:disabled]:bg-bg-disabled has-[input:disabled]:text-text-disabled has-[input:disabled]:border-border-disabled has-[input:disabled]:shadow-none has-[input:disabled]:hover:bg-bg-disabled has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:focus-within:border-destructive',
  {
    variants: {
      size: {
        sm: 'h-8 px-2.5',
        default: 'h-9 px-3',
        lg: 'h-10 px-3',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

const inputElementVariants = cva(
  'flex-1 min-w-0 bg-transparent border-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-sm',
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
    /** Optional className on the inner <input> element. */
    inputClassName?: string
  }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputClassName, type = 'text', size, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div
        className={cn(inputWrapperVariants({ size }), className)}
        data-slot="input-wrapper"
      >
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
      </div>
    )
  }
)

Input.displayName = 'Input'

export { inputWrapperVariants, inputElementVariants }
