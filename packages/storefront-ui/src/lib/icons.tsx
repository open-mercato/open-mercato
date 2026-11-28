import * as React from 'react'

// Internal lucide paths (ISC) for the handful of glyphs the primitives need.
// Not exported from the package: consumers bring their own icon set.
type IconProps = React.SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const MinusIcon = (props: IconProps) => <Icon {...props}><path d="M5 12h14" /></Icon>
export const PlusIcon = (props: IconProps) => <Icon {...props}><path d="M5 12h14" /><path d="M12 5v14" /></Icon>
export const XIcon = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>
export const CheckIcon = (props: IconProps) => <Icon {...props}><path d="M20 6 9 17l-5-5" /></Icon>
export const ChevronDownIcon = (props: IconProps) => <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>
export const ChevronUpIcon = (props: IconProps) => <Icon {...props}><path d="m18 15-6-6-6 6" /></Icon>
export const ChevronLeftIcon = (props: IconProps) => <Icon {...props}><path d="m15 18-6-6 6-6" /></Icon>
export const ChevronRightIcon = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>
export const SearchIcon = (props: IconProps) => <Icon {...props}><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></Icon>
export const InfoIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></Icon>
export const CircleAlertIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></Icon>
export const CircleCheckIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Icon>
export const TriangleAlertIcon = (props: IconProps) => <Icon {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></Icon>
export const TrashIcon = (props: IconProps) => <Icon {...props}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>
