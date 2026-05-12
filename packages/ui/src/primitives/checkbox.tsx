import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@open-mercato/shared/lib/utils"

const checkboxVariants = cva(
  "peer shrink-0 rounded-[4px] border border-input bg-background shadow-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-indigo/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent-indigo data-[state=checked]:text-accent-indigo-foreground data-[state=checked]:border-accent-indigo data-[state=indeterminate]:bg-accent-indigo data-[state=indeterminate]:text-accent-indigo-foreground data-[state=indeterminate]:border-accent-indigo hover:border-accent-indigo/60 transition-colors",
  {
    variants: {
      size: {
        sm: "size-4",
        md: "size-5",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  }
)

const indicatorIconBySize = {
  sm: "size-3.5",
  md: "size-4",
} as const

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> &
  VariantProps<typeof checkboxVariants>

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, size, ...props }, ref) => {
  const iconClass = indicatorIconBySize[size ?? "sm"]
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(checkboxVariants({ size, className }))}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
        {props.checked === "indeterminate" ? (
          <Minus className={iconClass} aria-hidden="true" />
        ) : (
          <Check className={iconClass} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox, checkboxVariants }
