import * as React from 'react'
import { CODE_TOKEN_CLASS, tokenizeCode } from '@/lib/highlight'

export function HighlightedCode({ code }: { code: string }) {
  const tokens = React.useMemo(() => tokenizeCode(code), [code])
  return (
    <code className="font-mono">
      {tokens.map((token, index) =>
        token.kind === 'plain' ? token.value : <span key={index} className={CODE_TOKEN_CLASS[token.kind]}>{token.value}</span>,
      )}
    </code>
  )
}
