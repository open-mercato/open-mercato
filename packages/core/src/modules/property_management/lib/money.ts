export function formatAmount(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`[internal] Invalid amount: ${value}`)
  return (Math.round(numeric * 10_000) / 10_000).toFixed(4).replace(/\.?0+$/, '')
}
