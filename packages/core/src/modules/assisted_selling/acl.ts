// Step 4.3 declared only `assisted_selling.settings.manage`, deferring the thread/message/
// proposal/attribution features until the entities/routes they gate existed (Step 1.7's
// precedent). Step 4.4 added `threads.view` (GET /threads), `threads.participate` (POST
// /threads, and now /join, /leave, /assign — Step 5.3) and `proposals.author` (POST
// /threads/:id/proposals, /proposals/:id/withdraw, /proposals/:id/reauthor — §6.1's own table
// gates authoring on BOTH this feature and `cart.proposals.author`, by design: "a rep who may
// converse but not propose" is a meaningful configuration).
//
// Step 5.3 adds `messages.post` (`POST /threads/:id/messages`, the console's own composer) —
// the one feature §6.9's full table names that Step 4.4 deferred for exactly this reason.
//
// Step 5.4 adds `attributions.view` (`GET /attributions`, the console's attribution report)
// — the last feature §6.9's own table names. Per §6.9's own grant text ("`attributions.view`
// ... stay[s] with `admin` or [is] granted by hand to the reps who sell"), `setup.ts`'s
// `employee` grant does NOT gain it — only the `admin: ['assisted_selling.*']` wildcard
// covers it by default (D-R5-7/D-R5-34's least-privilege line).
export const features = [
  { id: 'assisted_selling.settings.manage', title: 'Manage assisted-selling settings', module: 'assisted_selling' },
  { id: 'assisted_selling.threads.view', title: 'View selling conversations', module: 'assisted_selling' },
  { id: 'assisted_selling.threads.participate', title: 'Join selling conversations', module: 'assisted_selling' },
  { id: 'assisted_selling.proposals.author', title: 'Author proposals', module: 'assisted_selling' },
  { id: 'assisted_selling.messages.post', title: 'Post in selling conversations', module: 'assisted_selling' },
  { id: 'assisted_selling.attributions.view', title: 'View sales attribution', module: 'assisted_selling' },
]

export default features
