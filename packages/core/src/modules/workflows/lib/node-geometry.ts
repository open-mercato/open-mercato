/**
 * Rendered node geometry — the SINGLE source of truth for how much space a
 * workflow node occupies AND for how big its connection handles are.
 *
 * Two consumers need the same numbers and used to keep private copies in sync
 * behind a comment: `components/WorkflowNodeCard.tsx` (which renders the card)
 * and `lib/graph-utils.ts` (which reserves the footprint dagre lays out). Drift
 * between them is invisible until ranks silently overlap, so the numbers live
 * here instead. This module stays PURE — no React, no `lucide-react`, no
 * `@xyflow/react` — so the layout transform can import it in node and jest
 * contexts without pulling in the editor's render chain.
 *
 * The handle constants below joined it for the same reason: every node
 * component spelled its own `!w-3 !h-3 !border-2 !border-background` and the
 * outcome-row footer spelled a smaller one, so a footer dot and the source
 * handle floating beside it rendered at different diameters on the same card.
 * Tailwind scans this file (`@source ".../@open-mercato/core/src/**\/*.{ts,tsx}"`),
 * so the literals here are real utilities, not dead strings.
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

/**
 * Footprint of the canvas trigger node (fidelity gap #5) — the pill that states
 * how a definition is entered, drawn in the gutter BEFORE the START terminal.
 *
 * It is derived rather than measured for the same reason the outcome-row footer
 * is: the node is minted at render time from the definition's triggers and has
 * to be placed before React Flow has laid a single card out. It is never handed
 * to dagre (it is not a step and has no rank), so these numbers do not reserve a
 * box — they position one, and `TRIGGER_NODE_GAP` matches dagre's own `ranksep`
 * so the pill sits one rank-gap ahead of START rather than at some second
 * spacing nothing else on the canvas uses.
 */
export const TRIGGER_NODE_WIDTH = 200
/** The pill itself: icon + label, at the terminal pills' vertical rhythm. */
export const TRIGGER_NODE_HEADER_HEIGHT = 32
/** One dashed event tag (or the manual-start / overflow line) plus its gap. */
export const TRIGGER_NODE_ROW_HEIGHT = 22
/** Horizontal clearance between the trigger pill and the START terminal. */
export const TRIGGER_NODE_GAP = 80

/**
 * Diameter, in px, of a connection handle. One number for the target handle,
 * every source handle, the error handle and the terminal pills' handles: a
 * canvas where the dots differ in size reads as a rendering bug, and the
 * maintainer's report of "different sizes" was exactly a 10px footer dot next
 * to a 12px floating one.
 */
export const NODE_HANDLE_SIZE = 12

/** Tailwind form of {@link NODE_HANDLE_SIZE}. */
export const NODE_HANDLE_SIZE_CLASS = '!h-3 !w-3'

/**
 * The ring that lifts a handle off whatever it overlaps. Kept with the size so
 * a handle can never be resized without its border following.
 */
export const NODE_HANDLE_BORDER_CLASS = '!border-2 !border-background'

/** Size + ring. Callers add only the DS colour token the handle speaks with. */
export const NODE_HANDLE_CLASS = `${NODE_HANDLE_SIZE_CLASS} ${NODE_HANDLE_BORDER_CLASS}`

/**
 * How far a handle overhangs the edge it sits on — half its diameter, so it
 * straddles the border rather than floating beside it. React Flow positions
 * edge-anchored handles itself; this is for handles placed by a row's own
 * layout (the outcome footer), which have to reproduce the same overhang.
 */
export const NODE_HANDLE_EDGE_OFFSET = -(NODE_HANDLE_SIZE / 2)

/**
 * Sub-workflow IO ports are deliberately smaller than a control-flow handle:
 * a sub-workflow fans out one per declared input/output along an edge a
 * control-flow handle owns alone. Registered here anyway so the two sizes are
 * a decision made in one file rather than a drift discovered on a card.
 */
export const NODE_PORT_HANDLE_SIZE_CLASS = '!h-2.5 !w-2.5'
export const NODE_PORT_HANDLE_CLASS = `${NODE_PORT_HANDLE_SIZE_CLASS} !border !border-background`

/**
 * Geometry of the chips a route renders at its midpoint (`WorkflowRouteChips`,
 * #4244) — the condition summary, the activity icons and the `+N` overflow.
 *
 * They live here for the reason the handle constants do: a canvas element whose
 * size is spelled inline in the component that draws it drifts. The activity
 * chip was the drift's first casualty — an icon at `size-3` in `px-1.5 py-0.5`
 * padding rendered an ~18px box carrying a 12px glyph, which is the size of a
 * connection handle and unreadable at any canvas zoom below 1. A route chip is
 * something the author reads, not a dot they aim at, so it is sized against the
 * card it sits between rather than against the handle it sits near: the icon is
 * {@link ROUTE_CHIP_ICON_SIZE}px and the box lands near {@link ROUTE_CHIP_HEIGHT}px,
 * comfortably under half of {@link NODE_HEIGHT} so a chip never competes with the
 * steps it connects.
 *
 * The label stays `text-xs` — the DS floor the node config summaries already
 * hold — so a chip grows by its glyph and its padding, never by inventing a
 * type size the design system does not have.
 */
export const ROUTE_CHIP_ICON_SIZE = 20

/**
 * Tailwind form of {@link ROUTE_CHIP_ICON_SIZE}. For the ICON-ONLY activity
 * chip, where the glyph is the whole chip and has to carry it alone.
 */
export const ROUTE_CHIP_ICON_CLASS = 'size-5'

/**
 * The glyph on a chip that also carries text (the condition summary, the
 * `otherwise` marker). It sits on the label's optical line, so it is sized
 * against the `text-xs` next to it rather than against the canvas — at
 * {@link ROUTE_CHIP_ICON_SIZE} it would tower over its own label.
 */
export const ROUTE_CHIP_LABEL_ICON_CLASS = 'size-3.5'

/** Breathing room around a chip's glyph, on the DS spacing scale. */
export const ROUTE_CHIP_PADDING_CLASS = 'px-2 py-1'

/**
 * Rendered height of a chip: the glyph plus {@link ROUTE_CHIP_PADDING_CLASS}'s
 * 4px vertical padding on each side plus the 1px border on each side. Derived
 * so the ratio to the node card stays checkable.
 */
export const ROUTE_CHIP_HEIGHT = ROUTE_CHIP_ICON_SIZE + 8 + 2

/**
 * Everything a chip shares regardless of what it says. Callers add only the DS
 * colour tokens and the interaction states their own chip speaks with.
 *
 * On the radius: the DS scale has no 4px step for a chip — it is either
 * `rounded-full` (pill) or `rounded-md`. Bare `rounded` was neither, and read as
 * a slightly squared-off box next to every other chip in the product.
 */
export const ROUTE_CHIP_CLASS = `inline-flex items-center gap-1 rounded-md border bg-card ${ROUTE_CHIP_PADDING_CLASS} text-xs font-medium`
