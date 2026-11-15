'use client'

import * as React from 'react'
import { BRAND_STYLE_ELEMENT_ID, brandStyleCss } from './brand-style'
import { useBrandStyle } from './useBrandStyle'
import { useContentSecurityPolicyNonce } from './ContentSecurityPolicyProvider'

export function BrandStyleRuntime() {
  const style = useBrandStyle()
  const nonce = useContentSecurityPolicyNonce()
  React.useEffect(() => {
    if (!style) return
    const element = document.createElement('style')
    if (nonce) element.nonce = nonce
    element.id = BRAND_STYLE_ELEMENT_ID
    element.textContent = brandStyleCss(style)
    document.head.appendChild(element)
    return () => element.remove()
  }, [style, nonce])
  return null
}
