"use client"

import * as React from 'react'
import { SimpleTooltip } from '../primitives/tooltip'
import { cn } from '@open-mercato/shared/lib/utils'

export type TruncatedCellProps = {
  children: React.ReactNode
  /** Maximum width for the cell content. Can be a Tailwind class (e.g., 'max-w-[200px]') or CSS value */
  maxWidth?: string
  /** Custom class name for the wrapper */
  className?: string
  /** Tooltip content - if not provided, will try to extract text from children */
  tooltipContent?: React.ReactNode
  /** Disable truncation and tooltip */
  disabled?: boolean
}

/**
 * Extracts text content from React nodes for tooltip display
 */
function extractTextContent(node: React.ReactNode): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node === 'boolean') return ''
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('')
  }
  if (React.isValidElement(node)) {
    // Handle React elements - extract text from props.children
    const props = node.props as Record<string, unknown>
    if (props) {
      // First try children
      if (props.children != null) {
        const childText = extractTextContent(props.children as React.ReactNode)
        if (childText) return childText
      }
      // Try common text props
      if (typeof props.value === 'string') return props.value
      if (typeof props.label === 'string') return props.label
      if (typeof props.title === 'string') return props.title
    }
  }
  // Try to convert to string as last resort
  if (node && typeof node === 'object' && 'toString' in node) {
    const str = String(node)
    if (str !== '[object Object]') return str
  }
  return ''
}

/**
 * A cell wrapper that truncates content and shows a tooltip on hover
 * only when the content is wider than the available space.
 *
 * @example
 * <TruncatedCell maxWidth="max-w-[200px]">
 *   <span>This is a very long text that will be truncated</span>
 * </TruncatedCell>
 */
export function TruncatedCell({
  children,
  maxWidth = 'max-w-[150px]',
  className,
  tooltipContent,
  disabled = false,
}: TruncatedCellProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [isTruncated, setIsTruncated] = React.useState(false)

  // Get tooltip content - prefer explicit tooltipContent, fall back to extracting from children
  const resolvedTooltipContent = tooltipContent ?? extractTextContent(children)

  // Check if content is truncated after render and on resize
  React.useEffect(() => {
    const checkTruncation = () => {
      const el = contentRef.current
      if (el) {
        setIsTruncated(el.scrollWidth > el.clientWidth)
      }
    }

    // Check on mount
    checkTruncation()

    // Use ResizeObserver to detect size changes
    const el = contentRef.current
    if (el) {
      const observer = new ResizeObserver(checkTruncation)
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [children, maxWidth])

  if (disabled) {
    return <>{children}</>
  }

  // Determine if maxWidth is a Tailwind class or a CSS value
  const isTailwindClass = maxWidth.startsWith('max-w-')
  const styleMaxWidth = isTailwindClass ? undefined : maxWidth
  const classMaxWidth = isTailwindClass ? maxWidth : ''

  const content = (
    <div
      ref={contentRef}
      className={cn(
        'overflow-hidden text-ellipsis whitespace-nowrap',
        classMaxWidth,
        className
      )}
      style={styleMaxWidth ? { maxWidth: styleMaxWidth } : undefined}
    >
      {children}
    </div>
  )

  // Only show tooltip when content is actually truncated
  if (!resolvedTooltipContent || !isTruncated) {
    return content
  }

  return (
    <SimpleTooltip
      content={resolvedTooltipContent}
      side="top"
      delayDuration={300}
    >
      {content}
    </SimpleTooltip>
  )
}
