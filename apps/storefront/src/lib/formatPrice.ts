export function formatPrice(amount: string | number, currencyCode: string, locale = 'en'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return ''
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num)
  } catch {
    return `${currencyCode} ${num.toFixed(2)}`
  }
}

export function formatPriceRange(
  min: string,
  max: string,
  currencyCode: string,
  locale = 'en',
): string {
  const minFormatted = formatPrice(min, currencyCode, locale)
  const maxFormatted = formatPrice(max, currencyCode, locale)
  if (min === max) return minFormatted
  return `${minFormatted} – ${maxFormatted}`
}
