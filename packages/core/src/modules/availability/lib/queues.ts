// Release 5 Phase 3 (Step 2.3, A11/A12, §10). Queue names are kept in their own constants,
// shared by each worker's `metadata.queue` and `lib/scheduling.ts`'s scheduler registrations
// so both sides name the same queue — same convention as `cart/lib/queues.ts`.
export const AVAILABILITY_EXPIRE_RESERVATIONS_QUEUE = 'availability-expire-reservations'
export const AVAILABILITY_RECONCILE_RESERVATIONS_QUEUE = 'availability-reconcile-reservations'
