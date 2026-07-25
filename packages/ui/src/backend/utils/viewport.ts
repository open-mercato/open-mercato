// Horizontal shift (px) needed to keep an overlay fully inside the viewport.
// Positive shifts right (overlay bleeds off the left edge), negative shifts left
// (bleeds off the right edge), 0 when it already fits. Keeps a small margin.
//
// The two branches are mutually exclusive for any overlay narrower than the
// viewport (minus the margins): clearing the left edge cannot then push the
// right edge off-screen. Callers that could exceed the viewport width MUST cap
// the overlay (e.g. `max-w-[calc(100vw-1rem)]`) — for a genuinely too-wide
// overlay this falls back to left-aligning it, which is the sane default.
export function computeMenuViewportShiftX(
  rect: { left: number; right: number },
  viewportWidth: number,
  margin = 8,
): number {
  if (rect.left < margin) return Math.ceil(margin - rect.left)
  if (rect.right > viewportWidth - margin) return Math.floor(viewportWidth - margin - rect.right)
  return 0
}
