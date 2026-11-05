# Integration Feasibility Analysis — Stripe

## Overview
- Stripe is a global payment processing platform
- REST API with official TypeScript SDK
- Hub: `payment_gateways` (GatewayAdapter per SPEC-044)
- Module ID: `gateway_stripe`
- Overall Feasibility: **Full** — best API design, reference gateway implementation

## API Analysis
- REST API v1: `POST /v1/checkout/sessions`, `POST /v1/payment_intents`, `POST /v1/refunds`
- Official TypeScript SDK: `stripe` npm package — excellent type safety
- Auth: API key (Bearer). Publishable key + Secret key pair
- Rate limits: 100 req/sec (standard), 300 req/sec (Connect). Generous
- Versioning: Date-based (2024-12-18). `Stripe-Version` header
- Idempotency: Native via `Idempotency-Key` header

## GatewayAdapter Mapping
| Method | Stripe API | Feasibility |
|--------|-----------|-------------|
| createSession | POST /v1/checkout/sessions | Full — redirect URL returned |
| capture | POST /v1/payment_intents/{id}/capture | Full — supports partial capture |
| refund | POST /v1/refunds | Full — partial and full. Async confirmation |
| cancel | POST /v1/payment_intents/{id}/cancel | Full |
| getStatus | GET /v1/payment_intents/{id} | Full — rich status with events |
| verifyWebhook | stripe.webhooks.constructEvent() | Full — SDK-assisted HMAC-SHA256 |
| mapStatus | See mapping below | Full — rich vocabulary |

## Status Mapping
| Stripe PaymentIntent Status | UnifiedPaymentStatus |
|----|-----|
| requires_payment_method | pending |
| requires_confirmation | pending |
| requires_action | pending (3D Secure / SCA) |
| processing | pending |
| requires_capture | authorized |
| succeeded | captured |
| canceled | cancelled |
| Charge.refunded | refunded |
| Charge.partially_refunded | partially_refunded |

## Webhook Events
- `payment_intent.succeeded` → captured
- `payment_intent.payment_failed` → failed
- `payment_intent.canceled` → cancelled
- `charge.refunded` → refunded/partially_refunded
- `charge.dispute.created` → no unified status (gap)
- `checkout.session.completed` → needs mapping (gap)

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Session creation | 5 / Excellent | Checkout Sessions purpose-built |
| Capture | 5 / Excellent | Full and partial |
| Refund | 5 / Excellent | Full and partial, async confirmation |
| Cancel | 5 / Excellent | Clean API |
| Status polling | 5 / Excellent | Rich status with events |
| Webhook verification | 5 / Excellent | SDK-assisted HMAC-SHA256 |
| Multi-currency | 5 / Excellent | 135+ currencies |
| Apple Pay / Google Pay | 5 / Excellent | Automatic |
| 3D Secure / SCA | 5 / Excellent | Automatic with Payment Intents |

## Key Challenges
1. **`checkout.session.completed` event**: Needs explicit mapping to GatewayTransaction
2. **`partially_captured` computation**: Must compare `amount_captured` vs `amount`
3. **Refund pending state**: Bank transfers take 5-10 business days
4. **Dispute/chargeback**: No `UnifiedPaymentStatus` equivalent. Add `disputed` or store in metadata
5. **Stripe Connect**: `applicationFeeAmount` not in `CreateSessionInput`

## Gaps Summary
- `UnifiedPaymentStatus` missing `disputed` state
- `checkout.session.completed` needs mapping
- Stripe Connect marketplace features not in SPEC-044
- Estimated effort: **2-3 weeks** (reference implementation)
