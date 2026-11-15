'use client'

import * as React from 'react'

declare let __webpack_nonce__: string | undefined

const ContentSecurityPolicyContext = React.createContext<string | undefined>(undefined)

export function ContentSecurityPolicyProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  const [documentNonce] = React.useState(nonce)
  if (typeof window !== 'undefined' && documentNonce) {
    const runtime = globalThis as typeof globalThis & { __webpack_nonce__?: string }
    runtime.__webpack_nonce__ = documentNonce
    __webpack_nonce__ = documentNonce
  }
  return <ContentSecurityPolicyContext.Provider value={documentNonce}>{children}</ContentSecurityPolicyContext.Provider>
}

export function useContentSecurityPolicyNonce(): string | undefined {
  return React.useContext(ContentSecurityPolicyContext)
}
