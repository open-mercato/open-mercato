/**
 * A modal Radix dialog marks everything outside its own content with
 * `aria-hidden="true"` / `data-aria-hidden="true"` (the `aria-hidden` package).
 * `ConfirmDialog` portals its native `<dialog>` into `document.body`, so a
 * confirmation opened on top of an already-open modal inherits that marking:
 * the browser still paints it in the top layer and it still intercepts pointer
 * events, but assistive technology — and `getByRole('alertdialog')` — cannot
 * reach it.
 *
 * `escapeAriaHiddenAncestors` lifts that marking off the dialog element and its
 * ancestor chain (up to and including `document.body`) for as long as the
 * confirmation is open, remembers the exact previous values, and puts them back
 * when the returned disposer runs so the outer modal stays hidden from AT
 * afterwards.
 *
 * A `MutationObserver` keeps the escape hatch honest while the confirmation is
 * open: an outer modal that (re-)marks a tracked node has its value recorded
 * and stripped again, and an outer modal that unmarks a node drops the
 * remembered value so the disposer never resurrects a stale attribute.
 */
const ARIA_HIDDEN_ATTRIBUTES = ["aria-hidden", "data-aria-hidden"] as const;

type TrackedNode = {
  node: Element;
  /** attribute -> value to put back when the confirmation closes */
  restore: Map<string, string>;
  /** attribute -> removals this helper issued but has not yet seen reported */
  selfRemovals: Map<string, number>;
};

function collectAncestorChain(element: Element, body: HTMLElement | null): Element[] {
  const chain: Element[] = [];
  let node: Element | null = element;
  while (node) {
    chain.push(node);
    if (node === body) break;
    node = node.parentElement;
  }
  return chain;
}

function strip(entry: TrackedNode, attribute: string): void {
  const value = entry.node.getAttribute(attribute);
  if (value === null) return;
  entry.restore.set(attribute, value);
  entry.selfRemovals.set(attribute, (entry.selfRemovals.get(attribute) ?? 0) + 1);
  entry.node.removeAttribute(attribute);
}

export function escapeAriaHiddenAncestors(element: Element | null): () => void {
  const noop = () => undefined;
  if (!element) return noop;
  const ownerDocument = element.ownerDocument;
  if (!ownerDocument) return noop;

  const tracked: TrackedNode[] = collectAncestorChain(element, ownerDocument.body).map((node) => ({
    node,
    restore: new Map<string, string>(),
    selfRemovals: new Map<string, number>(),
  }));

  for (const entry of tracked) {
    for (const attribute of ARIA_HIDDEN_ATTRIBUTES) strip(entry, attribute);
  }

  const observerConstructor = ownerDocument.defaultView?.MutationObserver;
  const observer = observerConstructor
    ? new observerConstructor((records) => {
        for (const record of records) {
          const attribute = record.attributeName;
          if (!attribute) continue;
          const entry = tracked.find((candidate) => candidate.node === record.target);
          if (!entry) continue;
          if (entry.node.getAttribute(attribute) === null) {
            const pending = entry.selfRemovals.get(attribute) ?? 0;
            if (pending > 0) {
              entry.selfRemovals.set(attribute, pending - 1);
              continue;
            }
            entry.restore.delete(attribute);
            continue;
          }
          strip(entry, attribute);
        }
      })
    : null;

  if (observer) {
    for (const entry of tracked) {
      observer.observe(entry.node, {
        attributes: true,
        attributeFilter: [...ARIA_HIDDEN_ATTRIBUTES],
      });
    }
  }

  return () => {
    observer?.disconnect();
    for (const entry of tracked) {
      for (const [attribute, value] of entry.restore) {
        entry.node.setAttribute(attribute, value);
      }
      entry.restore.clear();
      entry.selfRemovals.clear();
    }
  };
}
