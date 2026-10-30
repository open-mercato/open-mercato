# Contributed CRM tab priority QA

Verified published/local head `fb73acf5393b22522ce6d0110d074ebbcd5dd5bf`:9 independent browser checkpoints and3 committed company/person/deal integration cases PASS without retry.

Controlled HTTP500/403 responses exercise rendering; missing UUID and limited-principal feature gating use real application responses. The limited principal also sees an auxiliary admin-only denial toast while the public company tab remains usable. Evidence-only, without QA approval.

## 1. Default People tab remains selected for a newly created company with no linked people

PASS

![Default People tab remains selected for a newly created company with no linked people](default-empty.png)

## 2. Held real company request displays the loading message

PASS

![Held real company request displays the loading message](loading.png)

## 3. Controlled HTTP500 detail response renders its recovery state; simulation only

PASS

![Controlled HTTP500 detail response renders its recovery state; simulation only](http-500.png)

## 4. Controlled HTTP403 detail response renders its recovery state; simulation only

PASS

![Controlled HTTP403 detail response renders its recovery state; simulation only](http-403.png)

## 5. A real absent company UUID renders the safe not-found state

PASS

![A real absent company UUID renders the safe not-found state](not-found.png)

## 6. Injected positive priority precedes built-ins without changing the default; missing module and failed loader are isolated

PASS

![Injected positive priority precedes built-ins without changing the default; missing module and failed loader are isolated](contributed-desktop.png)

## 7. ArrowRight focuses and selects the next actual tab in sorted DOM order, including enabled-module contributions

PASS

![ArrowRight focuses and selects the next actual tab in sorted DOM order, including enabled-module contributions](keyboard-order.png)

## 8. Long negative-priority contribution remains reachable by normal tab-strip scrolling at390px

PASS

![Long negative-priority contribution remains reachable by normal tab-strip scrolling at390px](contributed-mobile.png)

## 9. Real limited principal retains public contribution while feature-protected tab remains absent

PASS

![Real limited principal retains public contribution while feature-protected tab remains absent](limited-principal.png)

## Native company-tab-priority

![company-tab-priority](company-tab-priority.png)

## Native company-tab-priority-mobile

![company-tab-priority-mobile](company-tab-priority-mobile.png)

## Native person-tab-priority

![person-tab-priority](person-tab-priority.png)

## Native person-tab-priority-mobile

![person-tab-priority-mobile](person-tab-priority-mobile.png)

## Native deal-tab-priority

![deal-tab-priority](deal-tab-priority.png)

## Native deal-tab-priority-mobile

![deal-tab-priority-mobile](deal-tab-priority-mobile.png)
