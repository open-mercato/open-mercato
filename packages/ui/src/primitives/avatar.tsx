import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const avatarVariants = cva(
  'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-xs',
        sm: 'size-7 text-xs',
        md: 'size-9 text-sm',
        lg: 'size-12 text-base',
        xl: 'size-16 text-xl',
      },
      variant: {
        default: 'bg-primary/10 text-primary',
        monochrome: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
)

function computeInitials(label: string): string {
  const trimmed = label.trim()
  if (!trimmed.length) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  const first = parts[0][0] ?? ''
  const last = parts[parts.length - 1][0] ?? ''
  return (first + last).toUpperCase()
}

export type AvatarProps = {
  label: string
  src?: string | null
  icon?: React.ReactNode
  ariaLabel?: string
} & VariantProps<typeof avatarVariants> &
  Omit<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label'>

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, label, src, icon, size, variant, ariaLabel, ...rest }, ref) => {
    const initials = React.useMemo(() => computeInitials(label), [label])
    return (
      <div
        ref={ref}
        role="img"
        aria-label={ariaLabel ?? label}
        className={cn(avatarVariants({ size, variant }), className)}
        {...rest}
      >
        {src ? (
          <img src={src} alt="" className="size-full object-cover" aria-hidden="true" />
        ) : icon ? (
          <span aria-hidden="true" className="flex items-center justify-center [&>svg]:size-[55%]">
            {icon}
          </span>
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </div>
    )
  },
)

Avatar.displayName = 'Avatar'

export { avatarVariants }

export type AvatarStackProps = {
  children: React.ReactNode
  max?: number
  size?: VariantProps<typeof avatarVariants>['size']
  className?: string
}

export function AvatarStack({ children, max = 4, size = 'md', className }: AvatarStackProps) {
  const items = React.Children.toArray(children)
  const visible = items.slice(0, max)
  const overflow = items.length - max

  return (
    <div className={cn('flex items-center [&>*:not(:first-child)]:-ml-2 [&>*]:ring-2 [&>*]:ring-background', className)}>
      {visible}
      {overflow > 0 && (
        <Avatar label={`+${overflow}`} size={size} variant="monochrome" className="-ml-2" />
      )}
    </div>
  )
}
