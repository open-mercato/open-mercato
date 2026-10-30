import type * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ResolvedStyle } from '../../../services/style-compiler'

/**
 * Turn a compiled `ResolvedStyle` into React `style` + `className` props for the
 * runtime apply seam (`.ai/specs/2026-05-22-forms-custom-styling.md` Step 5).
 *
 * `cssVars` carries both CSS custom properties (`--card`, `--om-text-color`, …)
 * and a small set of safe direct CSS props (`background`, `backgroundImage`,
 * `fontFamily`, `color`, `accentColor`). Custom-property keys are not part of
 * the `React.CSSProperties` index signature, so the typed `Record<string, string>`
 * is cast once here — the single documented CSS-custom-property cast. The values
 * are already re-validated by the compiler (hex / known `var(--…)` / fixed
 * template), and React escapes them as a style object (never a `<style>` string).
 */
export function styleProps(
  resolved: ResolvedStyle,
  ...extraClasses: Array<string | undefined>
): { style: React.CSSProperties; className: string } {
  const style = resolved.cssVars as React.CSSProperties
  return {
    style,
    className: cn(...resolved.classNames, ...extraClasses),
  }
}
