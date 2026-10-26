import React from 'react'
import figma from '@figma/code-connect'
import { PaymentIcon } from '../src/primitives/payment-icon'

figma.connect(PaymentIcon, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=2942-9995', {
  imports: ["import { PaymentIcon } from '@open-mercato/ui/primitives/payment-icon'"],
  props: {
    category: figma.enum('🧩 Type', { Water: 'water', Gas: 'gas', Electricity: 'electricity', Donate: 'donate', Internet: 'internet', Phone: 'phone', Rent: 'rent', Tax: 'tax' }),
  },
  example: ({ category }) => <PaymentIcon category={category} />,
})
