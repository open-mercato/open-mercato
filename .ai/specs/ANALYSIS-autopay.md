# Integration Feasibility Analysis — Autopay

## Overview
- Autopay (formerly Blue Media) is a Polish payment processor
- REST API + form POST integration
- Hub: `payment_gateways` (GatewayAdapter per SPEC-044)
- Module ID: `gateway_autopay`
- Overall Feasibility: **Partial** — functional for Polish B2C, significant implementation gaps
- NOT currently in SPEC-044 — new adapter required

## API Analysis
- Transaction: `POST /payment` (form POST) or `POST /webapi/rest/v1/transactions` (newer REST)
- Auth: Static serviceId + hashKey (SHA256 HMAC). No OAuth
- Rate limits: Not documented
- Sandbox: `sandbox.autopay.eu`
- **No official TypeScript SDK** (PHP, Java, .NET only)
- **Documentation Polish only** (PDF specification)
- Rebranding: URLs changed from `pay.bm.pl` to `pay.autopay.eu`

## GatewayAdapter Mapping
| Method | Autopay API | Feasibility |
|--------|-----------|-------------|
| createSession | POST /payment or POST /webapi/rest/v1/transactions → redirectUrl | Partial — REST API depends on account type |
| capture | **Not available** — immediate payment. Must be no-op | No-op |
| refund | POST /refund | Full — async confirmation via callback |
| cancel | **Not applicable** — expire naturally. Must be no-op | No-op |
| getStatus | POST /transactionStatus | Full |
| verifyWebhook | Validate Hash in ITN body (SHA256) | Full — form-encoded body |
| mapStatus | Limited set | Full |

## Status Mapping
| Autopay PaymentStatus | PaymentStatusDetails | UnifiedPaymentStatus |
|---|---|---|
| SUCCESS | AUTHORIZED/CONFIRMED | captured |
| FAILURE | PAYMENT_DECLINED/FRAUD | failed |
| PENDING | (various) | pending |
| ERROR | (various) | failed |

Note: Collapses `authorized` and `captured` into single `SUCCESS`. No separate auth hold.

## ITN (Instant Transaction Notification)
- POST to `URLReturn` specified at registration
- Form-encoded or XML body (configuration-dependent)
- Hash = SHA256 of pipe-separated fields: `ServiceID|OrderID|Amount|Currency|...|hashKey`
- No separate verify call needed (unlike P24)
- Merchant must respond with acknowledgment

## Payment Methods
| Method | Support |
|--------|---------|
| Polish bank transfers | Full — all major banks |
| BLIK | Full — on hosted page |
| Cards (Visa/MC) | Full — hosted form, 3DS |
| Google Pay | Full |
| Apple Pay | Partial — merchant agreement |
| PayPo (BNPL) | Partial |

## Comparison vs Polish Competitors
| Feature | Autopay | PayU | Przelewy24 |
|---------|---------|------|-----------|
| API maturity | Low-Medium | Good | Good |
| TypeScript SDK | None | Community | Community |
| Documentation | Polish PDF | EN + PL | EN + PL |
| Capture support | No | Yes | No |
| BLIK | Redirect | Standard + 0-click | Redirect + 0-click |
| Multi-currency | Limited (PLN) | Good | Partial |

## Key Challenges
1. **Polish-only documentation**: Non-Polish developers must translate
2. **No TypeScript SDK**: Raw HTTP implementation. Hash computation error-prone
3. **Form-POST vs REST divergence**: Account types vary. Handle both or require REST
4. **Hash field order sensitivity**: Exact pipe-separated order per request type
5. **API maturity gap**: No test mode toggle, no event log, no webhook history
6. **Idempotency key**: ITN lacks unique ID. Use `PaymentID + PaymentStatus`
7. **Rebranding**: Support both old and new URLs during transition

## Gaps Summary
- No TypeScript SDK — raw HTTP required
- Polish-only documentation
- API maturity lower than Stripe/PayU/P24
- Recommended only if explicit demand not served by P24
- Estimated effort: **3-4 weeks**
