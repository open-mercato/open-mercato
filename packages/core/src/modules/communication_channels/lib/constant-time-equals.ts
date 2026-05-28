/**
 * Length-checked, branch-minimal constant-time string comparison used to verify
 * provider webhook secrets / `clientState` nonces without leaking timing about
 * how many leading characters matched. Returns false fast only on length
 * mismatch (length is not itself secret here).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
