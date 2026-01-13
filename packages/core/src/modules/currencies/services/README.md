# Currency Services

## ExchangeRateService

The `ExchangeRateService` provides a high-level API to retrieve exchange rates with automatic fetching and daily fallback capabilities.

### Features

- **Database-first retrieval**: Checks for existing rates in the database before fetching
- **Automatic fetching**: If no rate is found, automatically fetches from registered providers
- **Daily fallback**: Recursively searches previous days if rates are not available
- **Multi-provider support**: Returns all rates from different providers for the same currency pair and date
- **Batch operations**: Efficiently fetch multiple currency pairs at once

### Basic Usage

```typescript
import type { ExchangeRateService } from './services/exchangeRateService'

// Get the service from DI container
const exchangeRateService = container.resolve<ExchangeRateService>('exchangeRateService')

// Get exchange rate for a specific date
const result = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: new Date('2024-01-15'),
  scope: {
    tenantId: 'tenant-123',
    organizationId: 'org-456',
  },
})

// result.rates contains all rates from different providers
// result.actualDate shows which date was actually used (might be earlier than requested)
if (result.rates.length > 0) {
  console.log(`Found ${result.rates.length} rates`)
  console.log(`Best rate: ${result.rates[0].rate}`)
  console.log(`From provider: ${result.rates[0].source}`)
  console.log(`Date used: ${result.actualDate}`)
} else {
  console.log('No rates found')
}
```

### Options

```typescript
const result = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: new Date(),
  scope: { tenantId, organizationId },
  options: {
    maxDaysBack: 30,      // Maximum days to look back (default: 30)
    autoFetch: true,      // Fetch from providers if not found (default: true)
  },
})
```

### Rate Types

Exchange rates include a `type` field indicating the bank's perspective:
- **`buy`**: Rate when the bank buys foreign currency (from bank's perspective)
- **`sell`**: Rate when the bank sells foreign currency (from bank's perspective)  
- **`null`**: Unspecified or not applicable

The type field is informational and helps users understand which perspective a rate represents. Since rates are stored as directional currency pairs (e.g., USD→PLN for "buy" and PLN→USD for "sell"), you select the appropriate rate by specifying the correct currency pair direction:

```typescript
// Get the "buy" rate (bank buys USD, you sell USD for PLN)
// This is stored as USD→PLN with type='buy'
const buyRate = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'PLN',
  date: new Date(),
  scope: { tenantId, organizationId }
})

// Get the "sell" rate (bank sells USD, you buy USD with PLN)
// This is stored as PLN→USD with type='sell'
const sellRate = await exchangeRateService.getRate({
  fromCurrencyCode: 'PLN',
  toCurrencyCode: 'USD',
  date: new Date(),
  scope: { tenantId, organizationId }
})
```

Providers automatically set the type when fetching rates:
- **NBP**: Uses bid (buy) and ask (sell) rates - creates two directional pairs
- **Raiffeisen**: Uses buy and sell rates - creates two directional pairs
- **Manual entries**: Users can specify the type or leave it null

### Date Validation

The service validates that the requested date is not in the future:

- **Today is allowed**: You can request rates for the current date
- **Future dates are rejected**: Requesting rates for tomorrow or later will throw an error
- **No minimum date**: Historical dates (even very old ones) are accepted

```typescript
// ✅ This works - today's date
const result = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: new Date(), // Today
  scope: { tenantId, organizationId },
})

// ✅ This works - historical date
const historicalResult = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: new Date('1950-01-01'), // Very old date is OK
  scope: { tenantId, organizationId },
})

// ❌ This throws an error
const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: tomorrow, // Error: Cannot get exchange rate for a future date
  scope: { tenantId, organizationId },
})
```

### Batch Operations

```typescript
// Fetch multiple currency pairs at once
const results = await exchangeRateService.getRates({
  pairs: [
    { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },
    { fromCurrencyCode: 'USD', toCurrencyCode: 'GBP' },
    { fromCurrencyCode: 'EUR', toCurrencyCode: 'PLN' },
  ],
  date: new Date(),
  scope: { tenantId, organizationId },
})

// Access results by currency pair
const usdToEur = results.get('USD/EUR')
if (usdToEur && usdToEur.rates.length > 0) {
  console.log(`USD/EUR rate: ${usdToEur.rates[0].rate}`)
}
```

### Error Handling in Batch Operations

When using `getRates()`, errors are captured in the result's `error` field instead of being thrown. This allows partial success when fetching multiple pairs.

```typescript
const results = await exchangeRateService.getRates({
  pairs: [
    { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },  // Valid
    { fromCurrencyCode: 'USD', toCurrencyCode: 'USD' },  // Error: same currency
    { fromCurrencyCode: 'GBP', toCurrencyCode: 'JPY' },  // May not have data
  ],
  date: new Date(),
  scope: { tenantId, organizationId },
})

// Check each result for errors or empty data
for (const [key, result] of results.entries()) {
  if (result.error) {
    // Operation failed with an error
    console.error(`Failed to get rate for ${key}: ${result.error.message}`)
  } else if (result.rates.length > 0) {
    // Success - got at least one rate
    console.log(`${key}: ${result.rates[0].rate}`)
  } else {
    // No error, but no data found either
    console.log(`${key}: No rates found`)
  }
}
```

### Daily Fallback Behavior

If a rate is not found for the requested date, the service will:

1. Check the database for the exact date
2. If not found and `autoFetch=true`, fetch from providers
3. If still not found, check the previous day
4. Repeat up to `maxDaysBack` days

This ensures you get the most recent available rate even if data for specific dates is missing.

### Example: Converting Currency Amounts

```typescript
async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: Date,
  scope: { tenantId: string; organizationId: string }
): Promise<number | null> {
  const exchangeRateService = container.resolve<ExchangeRateService>('exchangeRateService')
  
  const result = await exchangeRateService.getRate({
    fromCurrencyCode: fromCurrency,
    toCurrencyCode: toCurrency,
    date,
    scope,
  })

  if (result.rates.length === 0) {
    return null // No rate available
  }

  // Use the first rate (or implement your own provider selection logic)
  const rate = parseFloat(result.rates[0].rate)
  return amount * rate
}

// Usage
const usdAmount = 100
const eurAmount = await convertAmount(
  usdAmount,
  'USD',
  'EUR',
  new Date(),
  { tenantId: 'tenant-123', organizationId: 'org-456' }
)

if (eurAmount !== null) {
  console.log(`${usdAmount} USD = ${eurAmount.toFixed(2)} EUR`)
}
```

### Choosing Between Multiple Providers

When multiple providers return rates, you can implement your own selection logic:

```typescript
const result = await exchangeRateService.getRate({
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'EUR',
  date: new Date(),
  scope: { tenantId, organizationId },
})

if (result.rates.length > 1) {
  // Option 1: Use a specific provider
  const nbpRate = result.rates.find(r => r.source === 'NBP')
  
  // Option 2: Use the average
  const sum = result.rates.reduce((acc, r) => acc + parseFloat(r.rate), 0)
  const averageRate = sum / result.rates.length
  
  // Option 3: Use the lowest/highest rate
  const rates = result.rates.map(r => parseFloat(r.rate))
  const lowestRate = Math.min(...rates)
  const highestRate = Math.max(...rates)
}
```

## RateFetchingService

The `RateFetchingService` is a lower-level service that handles fetching and storing rates from external providers. It's used internally by `ExchangeRateService` but can also be used directly.

### Direct Usage

```typescript
import type { RateFetchingService } from './services/rateFetchingService'

const rateFetchingService = container.resolve<RateFetchingService>('rateFetchingService')

// Fetch rates for a specific date
const result = await rateFetchingService.fetchRatesForDate(
  new Date('2024-01-15'),
  { tenantId: 'tenant-123', organizationId: 'org-456' }
)

console.log(`Fetched ${result.totalFetched} rates`)
console.log(`By provider:`, result.byProvider)
console.log(`Errors:`, result.errors)
```

### When to Use RateFetchingService Directly

- Scheduled/batch fetching of rates
- Administrative operations
- When you want explicit control over the fetching process

### When to Use ExchangeRateService

- Business logic that needs exchange rates
- Currency conversion in orders, quotes, etc.
- When you want automatic fallback and caching

## Architecture

```
┌─────────────────────────┐
│  ExchangeRateService   │  ← High-level, business-focused
│  (Get rates with       │
│   automatic fetching)  │
└───────────┬─────────────┘
            │ uses
            ▼
┌─────────────────────────┐
│  RateFetchingService   │  ← Low-level, provider-focused
│  (Fetch and store)     │
└───────────┬─────────────┘
            │ uses
            ▼
┌─────────────────────────┐
│   Rate Providers       │
│   (NBP, Raiffeisen,    │
│    Custom, etc.)       │
└─────────────────────────┘
```

## DI Registration

Both services are automatically registered in the DI container:

```typescript
// In your code
const exchangeRateService = container.resolve<ExchangeRateService>('exchangeRateService')
const rateFetchingService = container.resolve<RateFetchingService>('rateFetchingService')
```
