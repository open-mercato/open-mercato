import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const textScale = ['display-xl', 'display-l', 'display-m', 'display-s', 'title', 'title-sm', 'body-lg', 'body', 'body-sm', 'body-xs', 'badge'].map((name) => `sf-${name}`)
const radii = ['badge', 'button', 'chip', 'field', 'card', 'tile', 'sheet'].map((name) => `sf-${name}`)
const controls = ['sf-sm', 'sf-md', 'sf-lg', 'sf-gutter-sm', 'sf-gutter-md', 'sf-gutter-lg', 'sf-grid-gap']

// Local copy on purpose: this package must not import @open-mercato/shared (storefront-app spec §3.2).
// tailwind-merge needs to know the storefront theme names, otherwise `text-sf-body` is read as a
// text colour and removes `text-primary-foreground` from the same class list.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: textScale }],
      rounded: [{ rounded: radii }],
      h: [{ h: controls }],
      w: [{ w: controls }],
      size: [{ size: controls }],
      gap: [{ gap: controls }],
      px: [{ px: controls }],
      py: [{ py: controls }],
      p: [{ p: controls }],
      'max-w': [{ 'max-w': ['sf'] }],
      shadow: [{ shadow: ['focus'] }],
      z: [{ z: ['sticky', 'dropdown', 'overlay', 'modal', 'popover', 'toast', 'tooltip'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
