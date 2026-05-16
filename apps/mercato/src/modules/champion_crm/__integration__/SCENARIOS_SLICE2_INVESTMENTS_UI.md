# Champion CRM Slice 2 — Investment / Apartment / Demo Flow UI E2E Scenarios

These 30 scenarios extend the original 20 Champion CRM paths with the agreed Slice 2 design:

- `ChampionInvestment` is the module-local aggregate/root for the offer.
- `ChampionApartment` is inventory under an investment.
- Deal has one primary `investmentId` + `apartmentId` in the free demo.
- Apartment lifecycle is changed only through domain actions, not raw UI updates.
- `deal_apartments` M:N, production inventory sync, documents, scoring, webhooks, and deep RODO are deferred to paid PoC.

## Coverage map

| ID | Business scenario | Setup | UI path | Primary assertions |
| --- | --- | --- | --- | --- |
| TC-CHAMP-CRM-021 | Demo seed creates Hussar Loft investment and three apartments | API seed `/api/champion-crm/demo/seed` as admin | Open lead inbox or investment/deal screens where linked data is exposed | Investment `Hussar Loft` exists with status `selling`; units `A2.14`, `A3.07`, `B1.03` exist under the same investment |
| TC-CHAMP-CRM-022 | Seed is idempotent and does not duplicate demo inventory | Run demo seed twice | Refresh relevant UI list/detail | Still exactly one `Hussar Loft`; unit numbers remain unique within the investment |
| TC-CHAMP-CRM-023 | Investment is visible as the root offer, not a core catalog product | Seed demo data | Open investment/detail UI once available, or linked deal/contact view | Shows investment name, city `Krakow`, status `selling`, price range/currency; no product/catalog navigation dependency |
| TC-CHAMP-CRM-024 | Investment detail shows apartment inventory | Seed demo data | Open `Hussar Loft` detail once route exists | Units `A2.14`, `A3.07`, `B1.03` are listed with status and price |
| TC-CHAMP-CRM-025 | Apartment inventory filtering by status | Seed demo data | Investment inventory table/filter UI | `available` filter shows all unreserved demo apartments before a deal reservation |
| TC-CHAMP-CRM-026 | Lead intake captures requested investment | Seed demo investment; submit Anna lead with `investmentId` | Open Anna lead detail | Lead shows `Hussar Loft` as interested investment and keeps source/message/UTM context |
| TC-CHAMP-CRM-027 | Anna lead is visible in inbox with investment context | Seed demo data | `/backend/champion-crm/leads` | Row for Anna Kowalska appears with source/status and a visible investment indicator or detail link |
| TC-CHAMP-CRM-028 | Inbox search finds Anna by name/email/phone | Seed demo data | Use inbox search | Searching `Anna`, `anna.kowalska@example.com`, or `501 200 300` returns Anna lead |
| TC-CHAMP-CRM-029 | Lead detail qualification action is clickable | Seed Anna lead | Open Anna lead detail and click qualify | Lead status changes to `zakwalifikowany`; activity and audit entries appear in the detail timeline |
| TC-CHAMP-CRM-030 | Qualification action is idempotent/safe on repeat | Qualified Anna lead | Click qualify again or call same action twice through UI/API | Status remains `zakwalifikowany`; no duplicate deal is created; audit history remains understandable |
| TC-CHAMP-CRM-031 | Create/open deal from lead | Qualified Anna lead | Click create/open deal on lead detail | Deal is created with stage `qualified`, linked to Anna contact, lead, and requested investment |
| TC-CHAMP-CRM-032 | Create/open deal is idempotent | Lead already has a deal | Click create/open deal again | Existing deal opens; no second deal for the same source lead |
| TC-CHAMP-CRM-033 | Deal detail renders core context | Deal from Anna lead | Open deal detail | Shows deal number/title, contact Anna, source lead, investment Hussar Loft, stage `qualified`, status `open` |
| TC-CHAMP-CRM-034 | Deal stage advances to offer_open | Deal stage `qualified` | Click `offer_open` stage action | Stage becomes `offer_open`; status remains `open`; activity/audit records stage change |
| TC-CHAMP-CRM-035 | Deal stage cannot jump to invalid stage | Deal stage `qualified` | Attempt unsupported stage value through UI/API | Mutation is rejected; UI does not expose invalid stages; persisted stage is unchanged |
| TC-CHAMP-CRM-036 | Assign available apartment to deal | Deal linked to Hussar Loft; unit A2.14 available | Select A2.14 and assign/reserve | Deal gets `apartmentId=A2.14`, `investmentId=Hussar Loft`; apartment becomes `reserved` for that deal |
| TC-CHAMP-CRM-037 | Reservation writes price/value snapshot | Deal reserves A2.14 | Open deal detail | Deal value/currency uses apartment price/list price; reserved unit and price visible |
| TC-CHAMP-CRM-038 | Reserved apartment disappears from available choices for other deals | A2.14 reserved by Anna deal | Open another deal reservation selector | A2.14 is unavailable/disabled; A3.07 and B1.03 remain available |
| TC-CHAMP-CRM-039 | Reservation conflict is blocked server-side | A2.14 reserved by Anna deal | Try reserving A2.14 from another deal via API/UI | Request fails with conflict/error; apartment `reservedByDealId` remains Anna deal |
| TC-CHAMP-CRM-040 | Deal stage advances to reservation_agreement on reservation | Deal reserves A2.14 | Open deal detail after reservation | Stage is `reservation_agreement`, status `reserved`, probability reflects reservation state |
| TC-CHAMP-CRM-041 | Contact 360 shows reserved apartment | Anna deal with A2.14 reserved | Open Anna Contact 360 | Contact page shows Anna, deal, Hussar Loft, unit A2.14, reserved status, and timeline |
| TC-CHAMP-CRM-042 | Contact 360 timeline shows full demo trail | Anna lead qualified + deal + reservation | Open Contact 360 timeline | Timeline includes form submit, qualification, deal created, apartment reserved, audit entries |
| TC-CHAMP-CRM-043 | Manual note added from lead/deal is visible in Contact 360 | Anna contact exists | Add note/call/task from UI where available | Activity appears in Contact 360 and related lead/deal timeline |
| TC-CHAMP-CRM-044 | Follow-up scheduling is visible after demo actions | Anna lead/deal exists | Schedule follow-up | `nextFollowupAt` or task activity is visible on lead/contact detail |
| TC-CHAMP-CRM-045 | Mark deal won sells the apartment | Deal reserved with A2.14 | Click mark won | Deal status/stage become `won`; apartment A2.14 becomes `sold`; contact lifecycle becomes `client` |
| TC-CHAMP-CRM-046 | Won deal cannot sell an unrelated apartment | Anna deal has A2.14 | Attempt to mark different apartment sold directly or from another deal | Only A2.14 tied to the won deal becomes sold; unrelated units remain available/reserved as before |
| TC-CHAMP-CRM-047 | Sold apartment is not selectable for new reservations | A2.14 sold | Open reservation selector for a new deal | A2.14 is hidden/disabled as sold; other available units remain selectable |
| TC-CHAMP-CRM-048 | End-to-end free-demo happy path | Fresh seed | Run UI path: inbox -> Anna lead -> qualify -> create deal -> reserve A2.14 -> advance/won -> Contact 360 | Final state: lead qualified, contact client, deal won, Hussar Loft linked, A2.14 sold, timeline/audit visible |
| TC-CHAMP-CRM-049 | Read-only user can view investment/apartment context but cannot mutate | Seed demo data; read-only user | Open lead/deal/contact UI as read-only | Data is visible; qualify/create/reserve/won controls are absent or fail with 403; no state changes |
| TC-CHAMP-CRM-050 | AI remains disabled during investment/apartment demo flow | Any demo state | Inspect UI/API defaults | No AI action is required or automatically invoked; optional adapter remains disabled by default |

## Recommended executable split

- `TC-CHAMP-CRM-021-028-investment-inventory.spec.ts`
  - seed/idempotency, investment root, apartment inventory, lead intake investment context, inbox search.
- `TC-CHAMP-CRM-029-040-deal-actions-ui.spec.ts`
  - qualify, create/open deal, stage changes, assign/reserve apartment, conflicts.
- `TC-CHAMP-CRM-041-050-contact360-demo-flow.spec.ts`
  - Contact 360, timeline, manual activities/follow-up, mark won/sold, read-only ACL, AI disabled.

## Implementation rule for specs

Where the UI exists, specs should click the UI. Where UI controls are still being built, specs may seed through API/action routes but must still verify the visible UI/read model. Missing controls should be documented with `test.step(...)`; selectors must not be invented.
