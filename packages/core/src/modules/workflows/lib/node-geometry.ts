/**
 * Rendered node geometry — the SINGLE source of truth for how much space a
 * workflow node occupies.
 *
 * Two consumers need the same numbers and used to keep private copies in sync
 * behind a comment: `components/WorkflowNodeCard.tsx` (which renders the card)
 * and `lib/graph-utils.ts` (which reserves the footprint dagre lays out). Drift
 * between them is invisible until ranks silently overlap, so the numbers live
 * here instead. This module stays PURE — no React, no `lucide-react`, no
 * `@xyflow/react` — so the layout transform can import it in node and jest
 * contexts without pulling in the editor's render chain.
 */

/** Narrowest a `w-fit` card may render. */
export const NODE_MIN_WIDTH = 180
/** Widest a `w-fit` card may render before its content wraps. */
export const NODE_MAX_WIDTH = 280
/**
 * Height of a title-only card: the type row plus the title row, plus the 4px
 * node-type accent cap (`border-t-4`) that replaced the card's 1px top border.
 * Under-estimating here is what makes dagre pack ranks tight enough to overlap,
 * so this errs toward the real footprint.
 */
export const NODE_HEIGHT = 88
/** Extra height the two-line `line-clamp-2` description adds to a card. */
export const NODE_DESCRIPTION_HEIGHT = 24

/**
 * Height one outcome row adds to a card's footer (fidelity gap #4): a 16px row
 * plus the 2px grid gap. An agent node with four wired outcomes is materially
 * taller than a bare one, and dagre reserves boxes from these numbers — under-
 * estimating is exactly what makes ranks overlap.
 */
export const NODE_OUTCOME_ROW_HEIGHT = 18

/**
 * Fixed chrome the footer costs once it exists at all: the hairline rule plus
 * its 4px vertical padding, and the inheritance note an agent node states.
 */
export const NODE_OUTCOME_FOOTER_CHROME_HEIGHT = 22

/**
 * Footprint of a terminal (START / END) node. Terminals render as compact
 * auto-width pills rather than full step cards, so reserving a card-sized box
 * for them would push the first and last rank apart for nothing.
 */
export const TERMINAL_NODE_MIN_WIDTH = 96
export const TERMINAL_NODE_HEIGHT = 36
