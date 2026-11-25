const OVERLAY_TARGET_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="combobox"]',
  '[aria-haspopup="listbox"]',
  '[aria-expanded="true"]',
  '[data-radix-popper-content-wrapper]',
].join(',')

const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[data-radix-popper-content-wrapper]',
].join(',')

function isInsideOverlay(target: EventTarget | null): boolean {
  if (!target || typeof Element === 'undefined' || !(target instanceof Element)) return false
  return target.closest(OVERLAY_TARGET_SELECTOR) !== null
}

function hasOpenOverlay(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

export type DealMergeShortcut = 'cancel' | 'submit' | null

export function resolveDealMergeShortcut(event: KeyboardEvent, blocked: boolean): DealMergeShortcut {
  const isEscape = event.key === 'Escape'
  const isSubmit = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
  if (!isEscape && !isSubmit) return null
  if (blocked || event.defaultPrevented || event.isComposing) return null
  if (isInsideOverlay(event.target) || hasOpenOverlay()) return null
  return isEscape ? 'cancel' : 'submit'
}
