'use client'

import * as React from 'react'

export type SignatureCaptureMode = 'drawn' | 'typed'

export type SignatureCanvasProps = {
  value: string | null
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  ariaLabel?: string
  clearLabel: string
}

/**
 * Mobile / tablet-first signature canvas. Strokes are captured via pointer
 * events with `touch-action: none` so a finger or stylus drag draws instead of
 * scrolling the page. On pointer-up the canvas is exported to a PNG data URL.
 */
export function SignatureCanvas({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  clearLabel,
}: SignatureCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const drawingRef = React.useRef(false)
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null)
  const hasStrokesRef = React.useRef(false)

  const getContext = React.useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const context = canvas.getContext('2d')
    if (!context) return null
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = 2
    context.strokeStyle = '#111827'
    return context
  }, [])

  const pointFromEvent = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }, [])

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return
      event.preventDefault()
      const context = getContext()
      if (!context) return
      canvasRef.current?.setPointerCapture(event.pointerId)
      drawingRef.current = true
      lastPointRef.current = pointFromEvent(event)
    },
    [disabled, getContext, pointFromEvent],
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || disabled) return
      event.preventDefault()
      const context = getContext()
      const last = lastPointRef.current
      if (!context || !last) return
      const point = pointFromEvent(event)
      context.beginPath()
      context.moveTo(last.x, last.y)
      context.lineTo(point.x, point.y)
      context.stroke()
      lastPointRef.current = point
      hasStrokesRef.current = true
    },
    [disabled, getContext, pointFromEvent],
  )

  const commit = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!hasStrokesRef.current) return
    onChange(canvas.toDataURL('image/png'))
  }, [onChange])

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      lastPointRef.current = null
      canvasRef.current?.releasePointerCapture(event.pointerId)
      commit()
    },
    [commit],
  )

  const clear = React.useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    hasStrokesRef.current = false
    onChange(null)
  }, [onChange])

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        role="img"
        aria-label={ariaLabel}
        className="w-full rounded-md border border-input bg-background"
        style={{ touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair', aspectRatio: '3 / 1' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div>
        <button
          type="button"
          disabled={disabled || !value}
          onClick={clear}
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * SHA-256 hex digest of the resolved consent clause text via Web Crypto.
 * Returns `null` when the crypto subtle API is unavailable (older runtime /
 * insecure context) so the caller can decline to set a partial value.
 */
export async function computeClauseSha256(clauseText: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const bytes = new TextEncoder().encode(clauseText)
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
