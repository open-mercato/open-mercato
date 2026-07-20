/**
 * Default grouping key for a notification type when the declaring module does not
 * provide an explicit `category`. Uses the prefix before the first dot (e.g.
 * `sales.order.created` → `sales`), or the whole id when there is no dot.
 *
 * This intentionally has NO knowledge of specific notification types — modules
 * that want a non-default grouping declare `category` on their notification type.
 *
 * Applied once, in `syncNotificationTypes`, so the mirrored row always carries a
 * resolved category and read paths never need a fallback branch.
 */
export function deriveCategory(type: string): string {
  const dot = type.indexOf('.')
  return dot === -1 ? type : type.slice(0, dot)
}
