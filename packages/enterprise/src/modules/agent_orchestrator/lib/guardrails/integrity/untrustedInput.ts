import type { UntrustedInputDecl, UntrustedSpan } from '../../../data/validators'
import { readAll } from './paths'

/**
 * Turns an agent's declared untrusted input fields into `input` spans for the
 * pre-call prompt-injection screen. Every string the declared path addresses
 * becomes one span: `sourceRef` is the field label, `locator` the concrete path
 * (both declaration names, never input content) and `injection` the field's
 * action. Fields declared `off`, missing values and non-string values yield no
 * span. The run input is read, never modified.
 */
export function buildUntrustedInputSpans(
  input: unknown,
  decls: readonly UntrustedInputDecl[] | undefined,
): UntrustedSpan[] {
  if (!decls || decls.length === 0) return []
  const spans: UntrustedSpan[] = []
  for (const decl of decls) {
    if (decl.injection === 'off') continue
    for (const match of readAll(input, decl.path)) {
      if (typeof match.value !== 'string') continue
      spans.push({
        sourceKind: 'input',
        sourceRef: decl.label,
        locator: match.concretePath,
        text: match.value,
        injection: decl.injection,
      })
    }
  }
  return spans
}
