# Integration Feasibility Analysis — PayU

## Overview
- PayU is a payment processor dominant in Poland/CEE, also India, LatAm
- REST API v2.1
- Hub: `payment_gateways` (GatewayAdapter per SPEC-044)
- Module ID: `gateway_payu`
- Overall Feasibility: **Full** for Poland/CEE — production-ready with gaps to close

## API Analysis
- REST API: `POST /api/v2_1/orders`, `PUT /api/v2_1/orders/{id}/status`, `POST /orders/{id}/refunds`, `DELETE /orders/{id}`
- Auth: OAuth 2.0 client credentials (`POST /pl/standard/user/oauth/authorize`). Token ~300s TTL. Must cache
- Rate limits: Not publicly documented
- Sandbox: `secure.snd.payu.com`

## GatewayAdapter Mapping
| Method | PayU API | Feasibility |
|--------|---------|-------------|
| createSession | POST /api/v2_1/orders → redirectUri | Full — amount in minor units |
| capture | PUT /orders/{id}/status (COMPLETED) | Adapted — status transition, not dedicated endpoint |
| refund | POST /orders/{id}/refunds | Full — partial and full. Async confirmation |
| cancel | DELETE /orders/{id} | Full |
| getStatus | GET /orders/{id} | Full |
| verifyWebhook | Validate OpenPayU-Signature header | Full — MD5/SHA-256/SHA-384 |
| mapStatus | See below | Good |

## Status Mapping
| PayU Order Status | UnifiedPaymentStatus |
|---|---|
| NEW | pending |
| PENDING | pending |
| WAITING_FOR_CONFIRMATION | authorized |
| COMPLETED | captured |
| CANCELED | cancelled |
| REJECTED | failed |

## Advanced Features
| Feature | Support |
|---------|---------|
| BLIK | Full — `payMethods: { payMethod: { type: 'PBL', value: 'blik' } }` |
| Apple Pay | Full — `{ type: 'AP' }` |
| Google Pay | Full — `{ type: 'GP' }` |
| Multi-currency | Partial — supported currencies |
| Recurring | Partial — card tokenization, merchant agreement |

## Key Challenges
1. **OAuth token caching**: Token ~300s TTL. Must cache to avoid rate limiting
2. **Signature algorithm flexibility**: MD5, SHA-256, SHA-384. Detect from `algorithm=` field
3. **PayU India incompatibility**: Completely different API. Separate module needed
4. **`capture()` semantics**: Status PUT, not dedicated endpoint. Must document
5. **Refund lifecycle**: `PENDING → FINALIZED` async. Don't mark refunded immediately
6. **Idempotency key**: No unique event ID. Derive from `orderId + status`

## Gaps Summary
- OAuth token caching implementation needed
- Signature algorithm auto-detection needed
- India API requires separate module
- Estimated effort: **3-4 weeks**
