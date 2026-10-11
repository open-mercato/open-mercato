'use client'

import * as React from 'react'
import { BRAND_STYLE_ELEMENT_ID, brandStyleCss } from './brand-style'
import { useBrandStyle } from './useBrandStyle'

export function BrandStyleRuntime() {
  const style = useBrandStyle()
  React.useEffect(() => {
    if (!style) return
    const element = document.createElement('style')
    element.id = BRAND_STYLE_ELEMENT_ID
    element.textContent = brandStyleCss(style)
    document.head.appendChild(element)
    return () => element.remove()
  }, [style])
  return null
}
