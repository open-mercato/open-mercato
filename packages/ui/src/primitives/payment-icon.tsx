import * as React from 'react'
import { KeyIcon, KeyIconGlyph, type KeyIconColor } from './key-icon'

export type PaymentIconCategory = 'water' | 'gas' | 'electricity' | 'donate' | 'internet' | 'phone' | 'rent' | 'tax'

const colors: Record<PaymentIconCategory, KeyIconColor> = {
  water: 'sky', gas: 'red', electricity: 'yellow', donate: 'pink', internet: 'blue', phone: 'orange', rent: 'green', tax: 'purple',
}

export function PaymentIcon({ category, ...props }: Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> & { category: PaymentIconCategory }) {
  return <KeyIcon size={40} appearance="lighter" color={colors[category]} {...props} data-slot="payment-icon" data-category={category}><KeyIconGlyph name={category} /></KeyIcon>
}
