/**
 * Default kanban lane width in pixels (matches SPEC-048 Figma node 982:335). Operators can
 * override per-lane via the drag-resize handle; this constant is the fallback used when no
 * override is recorded.
 *
 * Centralised here so the value can't drift between the Lane wrapper, the AddStageLane CTA,
 * and the page-level DragOverlay — three places that previously hand-wrote `w-[308px]` and
 * `style={{ width: '308px' }}` independently.
 */
export const LANE_WIDTH_PX = 308

/**
 * Tailwind utility class encoding `LANE_WIDTH_PX`. Use this in `className` templates;
 * use `LANE_WIDTH_PX` in inline `style` blocks where the width is genuinely dynamic.
 */
export const LANE_WIDTH_CLASS = 'w-[308px]'
