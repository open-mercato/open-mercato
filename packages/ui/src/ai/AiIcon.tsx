import { Sparkles, type LucideProps } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

export function AiIcon({ className, ...props }: LucideProps) {
  return (
    <Sparkles
      aria-hidden
      {...props}
      className={cn(className, 'text-brand-violet')}
    />
  )
}
