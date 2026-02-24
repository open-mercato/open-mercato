# Integration Feasibility Analysis — Przelewy24

## Overview
- Przelewy24 (P24) is a Polish payment processor for bank transfers, BLIK, cards
- REST API v1
- Hub: `payment_gateways` (GatewayAdapter per SPEC-044)
- Module ID: `gateway_przelewy24`
- Overall Feasibility: **Full** for Polish market — with important contract deviations

## API Analysis
- REST API: `POST /api/v1/transaction/register`, `PUT /api/v1/transaction/verify`, `PUT /api/v1/transaction/refund`
- Auth: HTTP Basic (merchantId:apiKey). Two credentials: API key (REST auth) + CRC key (signature)
- Sandbox: `sandbox.przelewy24.pl`
- No official TypeScript SDK

## GatewayAdapter Mapping — KEY DEVIATIONS
| Method | P24 API | Feasibility |
|--------|---------|-------------|
| createSession | POST /transaction/register → token. Redirect: `{baseUrl}/trnRequest/{token}` | Full |
| capture | **Not applicable** — one-step payment, no pre-auth. **Must be no-op** | No-op |
| refund | PUT /transaction/refund | Full but complex — requires P24 numeric orderId |
| cancel | **Not applicable** — transactions expire. **Must be no-op** | No-op |
| getStatus | GET /transaction/by/sessionId/{sessionId} | Full |
| verifyWebhook | **TWO-STEP**: parse notification + PUT /transaction/verify | Full — but has side effect (outbound API call) |
| mapStatus | Minimal status set | Full |

## Critical: verifyWebhook() Side Effect
After validating SHA384 signature, adapter MUST call `PUT /api/v1/transaction/verify` — an outbound HTTP call within `verifyWebhook()`. Unavoidable with P24.

## Status Mapping
| P24 Status | UnifiedPaymentStatus |
|---|---|
| verified | captured |
| error | failed |
| pending | pending |
| Refund confirmed | refunded / partially_refunded |

Note: **No `authorized` state.** No pre-authorization flow. Status machine skips `authorized`.

## Webhook Signature
- SHA384 of JSON fields in **exact order**: `{"sessionId":"...","orderId":...,"amount":...,"currency":"...","crc":"..."}`
- CRC is merchant's CRC key
- Field order is exact — must use explicit concatenation

## Polish Market Specifics
- Bank transfers as primary method
- BLIK dominant (redirect and 0-click supported)
- PLN primary currency
- 14-day consumer refund requirement

## Key Challenges
1. **capture() and cancel() are no-ops**: No pre-authorization model
2. **verifyWebhook() side effect**: Outbound API call in verification. If P24 down, webhook unprocessed (P24 retries)
3. **Two different IDs**: Numeric `orderId` (P24 internal) vs `sessionId` (merchant). Refund requires numeric orderId. Store in `gatewayMetadata`
4. **Signature field order**: Exact JSON field order required. Wrong order = failure
5. **Session expiry without webhook**: Abandoned sessions don't always get expiry webhook. Status poller needed
6. **Refund API complexity**: Requires numeric orderId, requestId (UUID), amount, separate signature

## Gaps Summary
- Numeric orderId must be stored in gatewayMetadata
- Strict signature field order implementation
- Two no-op methods must be documented
- Estimated effort: **3-4 weeks**
