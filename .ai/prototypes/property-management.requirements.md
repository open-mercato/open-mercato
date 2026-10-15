# Property Management

> Requirements for the `property_management` core module (office-space management), 2026-10-14.

## Context

The company operates co-working spaces across multiple buildings. Each building has one or more
floors; each floor is divided into one or more **spaces** (a coworking area, a car park, a wing for
tenants from one industry); and each floor holds **units** — anything that can be leased or booked:
private offices and company units leased to tenant companies, parking spaces and desks, and meeting
units booked by the hour. A building manager needs a fast, visual way to see, for any floor they
oversee, which units currently have an active lease and which have bookings today — without
digging through separate lease and booking records.

The buildings and floors the floor plan draws are themselves records a manager maintains: a
**Buildings** page is the CRUD behind the building switcher — add a location, fix its address, add
or rename a floor, remove one that no longer exists — and each floor has its own page where its
spaces and units are set up. A **Leases** page holds the leases the floor plan's occupancy is read
from, including offering a tenant an extension when one runs out, and a **Bookings** page lists
every booking of a bookable unit across every location.

This module integrates with the existing Open Mercato **customers** module (the CRM): tenants are
CRM Company records and tenant contacts and booking organizers are CRM People records. Every unit is
typed and priced by the **catalog** module: a unit's type is a catalog category and its product is a
catalog product from that category. Customers book units, check their lease and answer extension
offers in their own **portal**; this module contributes those portal pages (Bookings and My leases)
and the booking and lease notifications in the portal's bell.

## Scope decisions

- **Occupancy** = an office has an active lease/assignment (a tenant company is currently under
  contract for that office), not real-time physical presence.
- **Office status** has three values: occupied (active lease), available (vacant, ready to lease),
  and unavailable (vacant, but under maintenance/blocked from leasing).
- **Office types** = two, matching Acme Corp's products: a **Private
  office** (1–10 people) and a **Company unit** (11–80 people). Both are private, walled premises
  under lease — distinct from an Open space membership, which has no private room at all — and both
  use the same three office statuses. A Company unit is visually the larger footprint on the floor
  plan and additionally states its capacity; there is no third, in-between size. In the unit model
  these are two of the catalog categories a unit's type is drawn from (§Unit type and product).
- **Data model** = a **building** has one or more **floors**; a **floor** is divided into one or
  more **spaces** and holds one or more **units**; every unit sits in exactly one space on its floor.
  Floors, spaces and units are all rectangles measured in metres.
- **Spaces** = a space is a named rectangle on its floor with an optional free-text **purpose**
  ("Tenant parking", "Fintech tenants"). Spaces never overlap and must lie inside their floor. Every
  floor is created with one **default space** covering 100% of it, so a floor that is never divided
  needs no setup and the floor plan draws no space outlines for it. Once a floor is divided, its
  spaces need not cover all of it — an area can sit in no space (stairs, lifts).
- **Dividing a floor works like partitioning a disk** = no space ever grows or shrinks on its own.
  To create a space on a floor whose area is already taken — including a floor that still has only
  its default space — the manager first shrinks an existing space, then creates the new one in the
  freed area. Shrinking can leave units outside the space; such a layout **cannot be saved**: every
  unit on the floor must lie fully within one space at all times. The resize form names each unit
  that would stick out and keeps Save disabled until the space is large enough again — units are
  moved or resized on their own form, never by the space form.
- **Units** = a unit is anything that can be leased or booked — the generic term that replaces
  "unit". A unit has a **name**, a **space**, a **type**, a **product**, a **size** and a
  **position**, and renders proportionally on the floor plan. It must lie inside its space and may
  not overlap another unit.
- **Unit type and product** = a unit's type is a **catalog category** (Private offices, Company
  units, Meeting rooms, Open space, Parking) and its product is a **catalog product** chosen only
  from the products assigned to that category — the product list is filtered by the type, never
  free. The categories and products shown are illustrative; in production they are whatever the
  operator's catalog holds.
- **Leasable and bookable units** = whether a unit is leased or booked is a property of its
  **catalog product**, not of its category and not something chosen per unit. It is per product
  because catalog categories are hierarchical and one category can hold both kinds: in Open space,
  "Flex desk" is bookable and "Dedicated desk" is leasable. Every Private office, Company unit and
  Parking product is leasable; every Meeting room product is bookable. Leasable units carry the
  occupied / available / unavailable statuses and appear in Leases; bookable units carry booked /
  free and appear in Bookings. In counts and legends they are called "leasable units" and
  "bookable units".
- **Changing a unit that is in use** = a unit with an active lease or upcoming bookings **can be
  moved or resized** (the usual fit and overlap rules still apply), but its **type and product are
  locked while it has an active lease** — the lease was signed for that product. A bookable unit's
  product **can change even while it has upcoming bookings**: the new product and its price apply
  to bookings made from then on (§Bookings keep their product and price). A unit **cannot be
  deleted** while it has any lease or booking; those have to be cancelled first, and the delete
  control says which lease or bookings are in the way.
- **Bookings keep their product and price** = every booking records the unit's product and price
  at the moment it was made, and keeps them: the customer paid the price in force at that point,
  and a later change to the unit's product — or to the product's price in the catalog — never
  changes a booking already made. Every unit keeps a **product history**: each product it has had,
  its price, and when it was in force. Together with §Lease product and history, this means both a
  lease and a booking can always say what was sold and at what price.
- **Building fields** = a building has a **name**, an **address**, and **floors**. Its floors are
  given as two counts — **floors below ground** and **floors above ground** — on both create and
  edit, and the floor rows are laid out and numbered from them, so the counts and the rows are one
  source of truth. Raising a count adds empty floors at the top or bottom; lowering it removes floors
  from the top or bottom. A floor that still has units on it cannot be removed:
  the count will not go below it, and the form says which floor is holding it.
- **Floor numbering** = the ground floor is **0**, floors above it are numbered 1 upwards and floors
  below ground −1 downwards. "Floors above ground" includes the ground floor, as Polish building
  counts include the *parter* — 3 above ground means floors 0, 1 and 2. Numbers are derived from the
  two counts, never typed, so a building cannot have a duplicate floor or a gap. Harbor Point runs
  0–3: "Ground Floor — Reception", then the 1st, 2nd (the modeled West Wing, offices 201–206 and
  Company Unit 2A) and 3rd (Rooftop Terrace) floors. Office numbers follow the floor: 2xx is floor 2.
- **Floor size** = every floor has a **size**: a rectangle given as **x** (width) and **y** (depth)
  in metres, both required. Rectangular is a deliberate simplification for this iteration — an
  L-shaped or irregular floor is out of scope. The size is what the floor plan is drawn to
  (§Layout); validating that units fit inside it is not modeled. The floor plan states the floor's size next to
  its unit counts ("42 × 18 m"). Harbor Point's floors are illustrative: 0–2 are 42 × 18 m, the
  Rooftop Terrace (3) is 24 × 18 m.
- **Floor fields** = a floor has a **number**, a **name** ("2nd Floor — West Wing") and a **size**
  (§Floor size). Its spaces and units are counted on the building, not edited there: they are set up
  on the floor's own page, and a second place to create one would let the two drift.
- **Building lifecycle** = a building is **available**, **unavailable** (temporarily, §Availability)
  or **archived** (for good). There is no draft status.
- **Archiving a building** = how a location closes for good. An archived building leaves the
  buildings list, its totals and every location switcher (backoffice and portal), and takes no new
  leases or bookings; its leases, bookings, invoices and history are kept, read-only, under "Show
  archived". There is no restore. A building **cannot be archived while it has active leases or
  upcoming bookings** — the dialog names each one and keeps Archive disabled until they have ended,
  taken place or been cancelled; making it unavailable is the way to stop new business at once.
- **Opening hours** = a building may optionally have **opening hours**: a weekly schedule where
  each day is open (with from–to hours) or closed. Without them the building is bookable at any
  time. With them, **bookings are only offered inside opening hours** — the portal's slots stop at
  closing time and a flex desk's "all day" means opening to closing. Opening hours govern bookings
  only; tenants' access to their leased units is not affected. Harbor Point: Monday–Friday
  09:00–18:00, Saturday 10:00–14:00, Sunday closed. New buildings start without them.
- **Availability** = a **building, a floor and a space** can each be made **unavailable**, the same
  way a single unit can: with a reason, a start date and an optional end date ("until"). While
  unavailable, every unit inside takes **no new leases and no new bookings** — the most
  restrictive level wins, so a unit inside an unavailable space is unavailable whatever its own
  status. Making something unavailable **cancels the bookings** in the unavailable period — each
  customer is notified — and **never ends a lease**: an active lease whose unit sits in something
  unavailable keeps running and is flagged **"Unit unavailable"** (with the end date, if any) on
  the Leases list, whose filter has a chip for it. The confirmation names every booking it will
  cancel and every lease it will flag, and its confirm button says it cancels bookings.
- **Availability is a switch, everywhere** = wherever a building, floor, space or unit is listed —
  the buildings list, a building's floors, a floor's spaces and units — and on its edit form,
  availability is the same **Available switch**, not a badge or a separate action. Switching it
  **off** opens a dialog with the same fields as the edit form — reason (required), from, until —
  that states what it cancels and flags; Confirm stays disabled until there is a reason, Escape
  cancels and ⌘/Ctrl+Enter confirms. Switching it back **on** takes effect at once. In a list, an unavailable item's switch is off, with its reason and
  end date beneath. A unit's switch is its own setting: a unit inside an unavailable space keeps
  its switch on but says it is unavailable through that space. An unavailable area is drawn hatched in the warning tone, with its reason and end date,
  and is marked unavailable in every location switcher (backoffice and portal). Examples:
  Elm Works (renovation until 30 Nov 2026), Harbor Point's ground-floor Parking (resurfacing
  until 18 Sep 2026).
- **Deleting a building** = confirmed by typing the building's name, and the confirmation states
  the counts that go with it (floors, spaces, units) plus what does *not* go with it
  (leases and bookings, which would be left without a building). Removing a floor that still has
  units on it is the same class of problem and is likewise unmodeled.
  Delete is for a building entered by mistake; the dialog points to Archive for a location that is
  closing for good.
- **Booking oversight** = the backoffice bookings list is read-only and portfolio-wide. "Active"
  means the booking is still ahead (upcoming or in progress); "archived" means it is done with
  (completed or cancelled). There is no separate archive action — the two are a view of status, not
  a flag someone sets. Search is fulltext across every column at once rather than per-column
  filters, because a manager searching a booking remembers one thing about it, not which field it
  was in.
- **Lease records** = a lease belongs to one **leasable unit** and one CRM Company, and carries a
  term and a monthly rate. Any unit whose product is leasable can be leased — private offices and
  company units today, and equally a parking space or a dedicated desk. Bookable units are never
  leased.
- **Lease product and history** = a lease **records the product it was signed for** — taken from
  its unit when drafted and fixed once the lease is activated — and keeps it even if the unit's
  product changes later. Every lease keeps a **history**: each version of its product, term and
  rate (drafted, activated, extension proposed, extension signed…), and for each version the
  invoices billed under it. The history must agree with the invoices: every invoice issued under a
  lease bills the product and rate of the version in force for the period it covers. A proposed
  extension is a history row with no invoices until it is signed and takes effect.
- **Lease lifecycle** = a lease is created on one of two paths, chosen with one checkbox on the
  same form:
  - **Lease proposal** → `proposed` → `active` (approved) / `declined` / `expired` → `ended`. It
    creates a sales quote that the customer's portal user approves or declines. The unit is
    reserved while the proposal is open. Approval converts the quote to the lease's sales order
    and invoices the first month. A declined proposal can still be approved until its deadline.
  - **Direct lease** → `active` on save → `ended`. For a lease agreed elsewhere: saving creates the
    sales order directly and invoices the first month.
  Either way the lease points to its sales order. Ending a tenancy early — notice,
  handover, final invoice — is its own flow and is out of scope here; shortening the end date is an
  ordinary edit, and deleting the record is for something entered in error, not for a tenant moving
  out. The deletion confirmation has to say that distinction out loud.
- **Lease uniqueness** = a unit may have at most one lease running at any moment (terms never
  overlap), so the create form only offers units free for the chosen term. A company has no such
  limit: it can lease several units at once (two offices, an office and a parking space).
- **Lease expiry warning** = an office whose lease ends within **60 days** is marked as such on the
  floor plan and in its detail panel. "Ending soon" is an *annotation on an occupied office*, not a
  fourth office status: the lease is still active and the office is still in use. It therefore uses
  a visual channel the three statuses do not — the tile keeps the neutral "in active use" fill and
  gains a dashed warning-toned edge plus a clock-marked badge naming the end date, while
  Unavailable (the only other warning-toned state) stays a solid warning fill. The threshold is one
  organization setting (default 60 days, §Settings), applied identically wherever expiry is surfaced.
- **Lease extensions** = the same two paths. An **extension proposal** creates a sales quote for
  the new term, answered in the portal; it states term, rate (with the difference from the current
  rate), what else changes, and its own response deadline. Approving is binding: it creates the
  extension's sales order and moves the lease end at once, and the screen says so before the click.
  A declined proposal stays approvable until its deadline. A **direct extension** records an
  extension agreed elsewhere and creates its order straight away. A manager composes either from the
  lease; a proposal shows a live preview of the exact card the tenant will see. Only one proposal
  may be outstanding at a time — withdraw before proposing again.
- **Layout** = a spatial floor plan **drawn to scale**: the floor is drawn as its own rectangle at
  its real proportions (§Floor size), and every unit, corridor and lobby is a
  rectangle with a position and a size in metres inside it — not a table or card grid. All floors
  of one building share a single scale (metres per pixel), set by the building's widest floor, so a
  smaller floor reads as smaller when a manager switches floors. The drawing carries its
  dimensions (width along the top, depth along the side) and a faint 1 m grid. An empty floor is
  still drawn to scale, as an outline with the "no units configured" message inside.
- **Unit geometry** = a unit's position (x, y of its corner, from the floor's top-left) and size
  (width × depth) are in metres; it must lie inside its space and may not overlap another unit or
  a common area. Units are rectangles, like floors and spaces. On Harbor Point's 2nd floor
  (42 × 18 m): offices 201–206 are 8 × 6 m, the Lobby 12 × 6 m, Studio 2B 7 × 6 m, Huddle Room
  5 × 6 m, the corridor 4 × 18 m, and Company Unit 2A 14 × 18 m. These sizes are illustrative.
- **Placing by drag and drop** = the position of a unit, a space and a common area is set by
  dragging it on the to-scale preview, never typed: the x, y fields are a read-only read-out.
  Dragging snaps to 0.5 m and keeps the item on the floor; the fit and overlap checks run while it
  moves. Dropping a unit fully inside a different space switches its Space to that one. Moving a
  space never carries its units along — units it leaves behind block Save, as when shrinking. For keyboard users the item
  takes focus and moves with the arrow keys (0.5 m, or 1 m with Shift). Size is still typed.
- **Common areas** = the floor's non-functional elements — corridors, kitchens, toilets, lobbies,
  stairs and lifts, storage. A common area has a **name**, a **kind** (a fixed list with "Other"),
  a **size** and a **position**, and nothing else: it is never leased or booked and has no catalog
  product. It belongs to the floor, not to a space, so it may sit inside a space or outside every
  space, and resizing a space never strands it. It must stay on the floor and may not overlap a
  unit or another common area. Harbor Point's ground floor has a Kitchen (in Coworking) and
  Toilets (in Reception); the West Wing's Lobby and Corridor are common areas too.
- **Interactivity** = read-only status view. The manager can click a unit to see its details, but
  cannot cancel a booking or change lease status from this screen — those actions live in their
  own lease-management and booking flows.
- **Scope of oversight** = a building manager may oversee multiple buildings and, within a
  building, multiple floors. The screen needs a building/floor switcher.
- **CRM integration** = the backend sidebar shows only this module's Facilities group; the
  `customers` module's own navigation is left out of the prototype for clarity. Every named individual shown anywhere in this product (a tenant's
  primary contact, a booking organizer) links out to their real CRM People record at
  `/backend/customers/people/[id]`, and every company name — tenant on an office or a lease — links out to its real CRM Company record at `/backend/customers/companies/[id]`. Those
  records live outside this prototype, so the links are illustrative (see Cross-cutting rules).
- **Currency** = PLN (zł), the organization's currency throughout this prototype.
- **Booking location** = a customer may book a bookable unit at *any* Acme Corp location, not only the
  one they lease at, so the backoffice bookings list, the portal's My bookings list and the portal
  booking flow all carry a location control. Bookings are created in the portal booking flow
  (Epic H).
- **One location fully modeled** = only Harbor Point has a modeled floor, occupancy and booking
  dataset; the other 6 locations (Linden House, Foundry Yard, Millstone Court, Northgate, Riverside Tower,
  Elm Works) carry illustrative totals only, and picking one in a switcher surfaces the
  prototype's "illustrative" toast.
- **Module boundary** = this module owns buildings, floors, spaces, units, leases, bookings (the
  backoffice list and the portal booking flow), the portal's My leases pages, and the booking and
  lease notifications in the portal bell. It reads from — but does not own — CRM People and
  Companies (`customers` module), product categories and products (`catalog` module, stored on a
  unit as IDs, never copied), sales documents (`sales` module — orders, invoices and payment
  collection), and the portal's other sections (access, events, invoices, support). Those destinations surface the
  "not part of this prototype" toast.
- **Portal booking scope** = browse today's bookable units at a location → pick a free slot →
  review and confirm. The list is every bookable unit at the location, grouped by floor — meeting
  rooms and flex desks alike — because what can be booked is decided by each unit's product
  (§Leasable and bookable units), not by a list of rooms.
- **Booking price** = every bookable unit has a published price in **złoty**, from its catalog
  product: meeting rooms per hour (50 zł for up to 4 seats, 100 zł for a larger room), a flex desk
  per day. The price is shown on the unit list, restated at review and on the confirmation, and
  each booking on My bookings states what it cost. Confirming a booking creates a sales order for
  that price (§Sales documents); how it is paid (invoice, card) is decided in sales, out of this
  module's scope.
- **Sales documents** = this module creates sales documents but does not own them. Activating a
  lease creates a sales order directly (the quote step is optional in sales and skipped): one line
  for the lease's product, quantity = months, unit price = monthly rate; on the invoice issue day this module issues that month's invoice
  against the order, so every invoice carries the lease version's product and rate. Each confirmed
  booking creates its own sales order (product and price as booked, no quote); cancelling the
  booking moves that order to the configured cancelled status. Order and invoice numbers are shown
  on the lease and the Bookings list and link to sales.
- **Settings** = one per organization: the sales channel lease and booking documents are created in
  (required — leases cannot be activated nor units booked until it is set), the invoice issue day
  (1–28, default 1), the sales order status for cancelled bookings, the lease-ending threshold
  (default 60 days), the booking reminder lead time (default 60 minutes) and the default proposal
  expiry (default 14 days, changeable per proposal).
- **Credits are out of scope** = plan credits, credit balances and buying credits are not part of
  this module and will be specified separately. Every booking is priced in złoty, to be paid in cash.
- **Where a booked unit is** = the review step shows the unit's floor drawn to scale with only the
  booked unit highlighted — the same drawing the manager uses, with nothing about who leases the
  units around it.
- **Portal lease scope** = the customer sees their *current* lease only — unit (with its product
  and size), term, rate, contact — plus the extension offer when one is open. No lease history.
- **Portal address order** = the building belongs to the Unit section, not to a page subtitle. A
  customer has one lease and does not need their location announced above the page title; they need
  to read unit, floor and building as one address, smallest first, the way they would say it.

## Epics

### Epic A — Get oriented on a floor at a glance
The manager opens the floor plan and immediately understands occupancy and booking status without
reading a list.

### Epic B — Drill into a specific unit
The manager needs more detail than a status color can convey — who leases an office, or who booked
a bookable unit and when — to answer a question or follow up. The floor plan is also where a lease
running out should first become visible: a manager scanning the floor should spot it without
opening the lease records.

### Epic C — Move between buildings and floors
The manager oversees more than one building/floor and needs to switch context quickly, keeping
their place if they navigate away and back.

### Epic D — Maintain the buildings and floors the floor plan is drawn from
The 7 locations and their floors are not fixed configuration — a manager signs a new building,
takes over another floor, or renames one after a refit. They need to maintain those records
themselves, in the same Facilities section where they use them, rather than filing a ticket.

### Epic E — Keep the lease records the whole product reads from
The floor plan, invoicing and the tenant's own portal all read from the lease records. A manager needs to maintain them — add one directly or propose it to the customer, correct one, remove one entered in
error — and, when one is running out, to offer the tenant an extension from the same place rather
than composing an email.

### Epic F — See every booking in one place
Bookings are made in the portal, one unit and one slot at a time. A manager needs the other view:
everything booked across every location, narrowed to the location they are dealing with, to what is
still ahead, or to whatever they can remember about it.

### Epic G — Set up a floor's spaces, units and common areas
A floor is not one undivided room: a ground floor can hold a coworking area and a car park, an upper
floor a wing for tenants from one industry. A manager needs to divide a floor into spaces, fill
them with units — each typed and priced from the catalog — and draw in its common areas, all
placed where they really are, so that everything the floor plan, Leases and Bookings show is built
on real records.

### Epic H — Book a unit from the customer portal
A customer (tenant staff or coworking member) needs to book a free meeting room or desk today without
calling or emailing the building manager — at any location, knowing what it costs and where it is.

### Epic I — Check my leases from the customer portal
A tenant customer wants to see their company's lease terms without asking the building manager — one
company can lease several units. When a lease is running out they should learn it from the portal rather than from a letter, and answer
the extension offer in the same place.

### Epic J — Know what needs my attention in the customer portal
A customer should not have to visit My bookings and My leases in turn to find out that a booking
begins in an hour or an extension offer is waiting. One bell in the portal header collects it, and
every entry links to the screen that resolves it. (Other modules — invoices, events — add their own
entries to the same bell.)

### Epic K — Configure how leases and bookings are billed
Leases and bookings become sales documents. A manager sets, once for the organization, which sales
channel those documents go to, when the monthly lease invoices are issued, and the lead times that
drive the lease-ending warning and booking reminders.

## User Stories

### US-A1 — See today's floor status at a glance
**As a** building manager
**I want to** open a floor plan showing every leasable and bookable unit with a clear occupied/vacant
or booked/free status
**So that** I can answer "what's the state of this floor right now" without cross-referencing
lease and booking systems.

Acceptance criteria:
- Offices render with a distinct visual status for each of: occupied (active lease), available
  (vacant, ready to lease), and unavailable (vacant, under maintenance/blocked).
- Each office also shows its type — Private office (1–10 people) or Company unit (11–80 people,
  §Office types) — and its capacity; a Company unit reads as visually larger on the floor plan.
- Bookable units render with a distinct visual status for booked (has ≥1 booking today) vs free (no
  bookings today).
- Status uses shape/color/icon+label together, not color alone.
- A legend explains each status and each office type, including both vacant sub-statuses.
- Default view on entry is today's date — there is no date picker in this iteration.

### US-A2 — Understand a floor with no units configured yet
**As a** building manager
**I want to** see a clear empty state when a floor has no units set up
**So that** I know the floor plan hasn't been configured rather than assuming a loading or data
error.

Acceptance criteria:
- Empty state names the floor and explains no units are configured for it.
- Empty state offers a path to floor/unit setup (illustrative link — setup flow is out of scope).

### US-A3 — See a floor that failed to load
**As a** building manager
**I want to** see a clear error state if lease or booking data can't be loaded
**So that** I don't mistake missing data for "everything is vacant/free."

Acceptance criteria:
- Error state is visually distinct from the empty state and from a fully-vacant/free floor.
- Error state offers a retry action.
- Occupancy and booking data are shown together or the failure is scoped per data source (e.g.
  bookings failed but lease data loaded) — occupancy must never silently default to "vacant" when
  its source failed.

### US-B1 — See who leases an office
**As a** building manager
**I want to** click an occupied office to see its type, the tenant company name, the lease's start
and end dates, and a contact
**So that** I can follow up on that tenant, including ahead of their lease ending, without opening
the lease system separately.

Acceptance criteria:
- Clicking an occupied office opens a detail panel/drawer with its type (Private office or Company
  unit, with capacity), tenant name, size, lease start date, lease end date, and primary contact.
- Every office panel — occupied, available or unavailable — states the office's size as width ×
  depth in metres plus its area ("8 × 6 m · 48 m²"), the same size the floor plan draws it at
  (§Unit geometry).
- Clicking an available office opens a detail panel indicating it is vacant and ready to lease,
  with no tenant information shown.
- Clicking an unavailable office opens a detail panel indicating it is vacant but unavailable
  (e.g. under maintenance), with no tenant information shown.
- Detail panel is dismissible via a close control, Escape, and clicking outside.
- Detail panel states plainly that lease changes happen in the lease-management flow, not here.

### US-B3 — Spot a lease that is about to run out
**As a** building manager
**I want to** see on the floor plan itself which offices have a lease ending soon, and how long is
left when I open one
**So that** I start the renewal conversation in time instead of finding out when the office empties.

Acceptance criteria:
- An office whose lease ends within the expiry threshold is marked on the floor plan without
  changing its status: it still reads as occupied, and the marker is visually distinct from the
  Unavailable state so the two are never confused.
- The marker is never colour alone — the tile names the end date in text, and the legend names what
  the marker means.
- Opening that office leads with how long is left and the exact end date, before the other lease
  facts.
- The panel offers a way through to the lease-management flow, where the renewal is actually made;
  the panel itself stays read-only.

### US-B2 — See today's bookings for a bookable unit
**As a** building manager
**I want to** click a bookable unit to see today's bookings (organizer, time range) in order
**So that** I know who is using the unit and when without opening the booking system.

Acceptance criteria:
- Clicking a booked bookable unit opens a detail panel listing today's bookings in chronological
  order, each with organizer and start–end time.
- Every bookable unit panel states its capacity and its size as width × depth in metres plus its
  area, matching the floor plan (§Unit geometry).
- Clicking a free bookable unit opens a detail panel indicating no bookings today.
- Back-to-back bookings are shown as separate rows. A unit never holds overlapping bookings: a
  request for a slot that is already taken is refused.
- Detail panel states plainly that booking changes happen in the booking flow, not here.

### US-C1 — Switch floors within a building
**As a** building manager
**I want to** switch between the floors of the building I'm viewing
**So that** I can check every floor I'm responsible for in one session.

Acceptance criteria:
- A floor switcher lists every floor of the current building.
- The current floor is clearly indicated as selected.
- Switching floors preserves the selected building and today's date context.

### US-C2 — Switch buildings
**As a** building manager
**I want to** switch to a different building I oversee
**So that** I'm not limited to a single building's floor plans.

Acceptance criteria:
- A building switcher lists only buildings the manager oversees (permission-scoped).
- Switching buildings resets the floor selection to that building's default (e.g. first/ground
  floor) and states which floor is now shown.
- A manager who oversees exactly one building still sees which building they're viewing (no
  switcher affordance required if there is nothing to switch to, but the identity must be visible).

### US-C3 — No buildings assigned
**As a** building manager
**I want to** see a clear message if I have not been assigned any building
**So that** I understand why the floor plan is empty and know to request access rather than assume
a bug.

Acceptance criteria:
- No-access state names the situation plainly and does not show an empty floor plan grid.
- No-access state offers a next step (e.g. contact an admin) — illustrative, no live contact flow.

### US-D1 — See every building I oversee
**As a** building manager
**I want to** see every building with its address and how much space is inside it
**So that** I can find the one I need to change without opening each in turn.

Acceptance criteria:
- Each building shows its name, address, and its floor, office, and bookable-unit counts.
- The counts are derived from the floors and units configured, not typed in, and are read-only here.
- The list totals the counts across all buildings.
- Adding a building is a primary action on this list; editing and deleting are reachable per row.

### US-D2 — Add a building
**As a** building manager
**I want to** add a location with its address and lay out its floors in one pass
**So that** the building is usable on the floor plan as soon as I save it.

Acceptance criteria:
- Name and address are required.
- The number of floors is given as two counts, below ground (0 or more) and above ground (1 or
  more), and the floors table is laid out from them.
- Floor numbers are shown but not editable: 0 is the ground floor, 1 upwards above it, −1
  downwards below it. Changing a count re-lays the table out and keeps names already typed.
- Floors are not added or removed one by one on create — the two counts are the only control.
- Every floor takes a size, x × y in metres, both required (§Floor size).
- Units are not created here — a newly created floor legitimately has none, which is the "no units
  configured yet" state the floor plan already handles (US-A2).

### US-D3 — Edit a building and its floors
**As a** building manager
**I want to** correct a building's name or address, rename its floors, and add or remove floors
**So that** the floor plan keeps matching the building as it actually is.

Acceptance criteria:
- Floors are edited in place, alongside the building, with no separate per-floor save.
- Floors are added or removed only by changing the below-ground and above-ground counts, as on
  create; floor numbers are shown but not editable, and there is no per-row add or remove.
- A count cannot be lowered past a floor that still has units on it; the form
  names that floor rather than silently refusing.
- Each floor's size (x × y, metres) is editable in place next to its name.
- Offices and bookable units per floor are shown but not editable here.
- There is a direct path from the building to its floor plan.
- Delete is separated from save so it is never a mis-click next to the primary action.

### US-D4 — Delete a building safely
**As a** building manager
**I want to** be told exactly what a deletion takes with it before it happens
**So that** I don't remove a location and discover the consequences afterwards.

Acceptance criteria:
- The confirmation names the counts that will be deleted with the building.
- It also names what is *not* deleted and would be left orphaned.
- Confirmation requires typing the building's name, not just clicking through.
- The dialog follows the prototype's dialog rule: Escape cancels, Cmd/Ctrl+Enter confirms.

### US-D5 — Set a building's opening hours
**As a** building manager
**I want to** optionally set the days and hours a building is open
**So that** customers can only book units while someone can let them in.

Acceptance criteria:
- Opening hours are optional and off for a new building; switching them on shows a weekly table.
- Each day is switched open or closed on its own; an open day has from–to hours.
- Bookings are only offered inside opening hours; leased units' access is not affected.

### US-D6 — Make a building unavailable
**As a** building manager
**I want to** take a whole building out of use for a while, with a reason and dates
**So that** nobody leases or books anything in it while it is closed.

Acceptance criteria:
- A building is available or unavailable; unavailable takes a reason, a start date and an
  optional end date.
- The buildings list shows each building's status, with the reason and end date when unavailable.
- While unavailable, none of its units take new leases or bookings, and it is marked unavailable
  in every location switcher.
- Bookings in the unavailable period are cancelled and their customers notified; active leases
  are not ended but flagged "Unit unavailable" on the Leases list.

### US-D7 — Archive a building
**As a** building manager
**I want to** close a location for good without losing its records
**So that** it stops appearing anywhere new, while its leases, bookings and invoices stay
traceable.

Acceptance criteria:
- Archive sits beside Delete on the building, and the delete dialog points to it.
- The dialog says archiving is for good and what is kept: leases, bookings, invoices and history,
  read-only.
- Archiving is blocked while the building has active leases or upcoming bookings; each one is
  named, linked, and Archive stays disabled.
- An archived building is not on the buildings list, in its totals or in any location switcher;
  the list says how many are archived and offers to show them.

### US-E1 — See every lease and where it stands
**As a** building manager
**I want to** see every office lease with its office, tenant, term, rate and status
**So that** I can find the one I need without opening each office on the floor plan.

Acceptance criteria:
- Each lease shows its reference, office, building, tenant, term, monthly rate and status.
- A lease within the expiry threshold is flagged with the days remaining, using the same threshold
  as the floor plan and the tenant's portal.
- The list can be narrowed by status (active, ending soon, proposed, ended, unit unavailable) and by
  building, and searched fulltext across every column.
- Every rate matches that tenant's monthly invoice, which this module issues against the lease's
  sales order.
- An active lease whose unit sits in something unavailable (unit, space, floor or building) is
  flagged "Unit unavailable" with the end date, alongside its status.

### US-E2 — Add a lease or propose one
**As a** building manager
**I want to** either create a lease for a CRM company directly, or send it to them as a proposal to
approve in their portal
**So that** a lease agreed elsewhere starts at once, and a new one waits for the customer's approval.

Acceptance criteria:
- Building, unit, tenant, start, end and rate are required; a "Send as a proposal" checkbox on the
  same form picks the path. A proposal also states how many days it stays open (prefilled from
  Settings, default 14); when they pass, it expires and the unit is released.
- Only units free for the whole term — no lease and no other open proposal — can be picked.
- The tenant is a CRM Company record, not free text.
- A direct lease is active on save: its sales order is created and the first month is invoiced.
- A proposal creates a sales quote, reserves the unit (the floor plan marks it Proposed) and bills
  nothing until the customer approves.

### US-E3 — Correct a lease
**As a** building manager
**I want to** fix an office, a date or a rate on an existing lease
**So that** the records the rest of the product reads from stay right.

Acceptance criteria:
- Office, dates and rate are editable; the tenant is not — moving a lease to a different company is
  a new lease.
- There is a direct path from the lease to its office on the floor plan.
- Delete is separated from save and confirmed separately.

### US-E4 — Extend a lease, directly or as a proposal
**As a** building manager
**I want to** extend a lease that is running out — directly, or by proposing it and seeing what the
tenant will be asked
**So that** I get an answer before it expires without starting an email thread.

Acceptance criteria:
- Proposing is a primary action on a lease that is ending, reachable from the lease itself.
- The form defaults to sensible values: the new term starts the day after the current one ends, a
  length picker sets the end date, and a response deadline defaults ahead of expiry.
- The rate field states the difference from the current rate in both currency and percent, and the
  tenant is shown the same difference.
- A "Send as a proposal" checkbox picks the path; unticked, the extension takes effect on save and
  its sales order is created.
- For a proposal, the manager sees a preview of the exact card the tenant will receive before
  sending; sending does not change the lease, and the screen says so.
- While a proposal is outstanding the lease shows what was offered, that it is unanswered, and when
  the tenant will be reminded; proposing again is not offered until the current one is withdrawn.
- There is a direct path to the tenant's own view of the offer.

### US-E5 — Delete a lease record safely
**As a** building manager
**I want to** be told what deleting a lease actually does before it happens
**So that** I don't use it to end a tenancy and leave the floor plan lying.

Acceptance criteria:
- The confirmation states that deleting the record does not end the tenancy, and names the action
  that does.
- It names the visible consequence — the office reading as vacant while the tenant is still in it —
  and what survives, such as invoices already issued.
- Confirmation requires typing the lease reference.

### US-E6 — See a lease's history
**As a** building manager
**I want to** see every version of a lease — its product, term and rate — and the invoices billed
under each
**So that** I can answer what a tenant had and paid at any point without leaving the lease.

Acceptance criteria:
- The lease shows the product it was signed for, read-only, with a note that it does not follow
  later changes to the unit's product.
- History lists every version, most recent first: date, event, product, term, rate and invoices.
- The lease shows its sales order (created directly, or from the approved proposal's quote), linked
  to sales.
- Each version's invoices match it — same product and rate — and link to sales.
- A proposed extension appears as its own version with no invoices until it takes effect.

### US-F1 — See and narrow every booking
**As a** building manager
**I want to** see every bookable unit booking across every location, and narrow it quickly
**So that** I can answer "who has that unit on Thursday" without opening each unit in turn.

Acceptance criteria:
- Each booking shows its unit, its location, who booked it, its date and time, the product and
  price it was booked as — which may differ from the unit's product today — and its sales order,
  marked cancelled when the booking was.
- The list covers every location by default and can be narrowed to one.
- Bookings can be narrowed to those still ahead (active) or already done with (archived).
- A single search box matches across every column at once, rather than one filter per column.
- The result count reflects what the filters left, and an empty result says so rather than showing
  a blank table.
- Rows are read-only: bookings are made and changed in the booking flow, not here.

### US-G1 — See how a floor is divided
**As a** building manager
**I want to** open a floor and see its spaces and the units inside each, drawn to scale
**So that** I can check the floor matches the building before anyone leases or books from it.

Acceptance criteria:
- A floor is reachable from its row on the building.
- The floor is drawn to scale with its spaces as labelled zones and its units inside them; an area
  in no space is visibly in none.
- Spaces are listed with purpose, position, size, area and unit count; the header states how much of
  the floor's area is in a space.
- Units are listed with space, type (catalog category), product (linked to the catalog), size, area
  and whether they are leasable or bookable.
- This view carries no lease or booking status — that belongs to the floor plan.

### US-G2 — Add a unit
**As a** building manager
**I want to** add a unit to a space, choose its type and product from the catalog, and place it
**So that** it can be leased or booked as soon as it exists.

Acceptance criteria:
- Name, space, type, product and size are required; the unit always has a position.
- Type lists the catalog categories; product lists only the products in the chosen category and
  changes when the type changes.
- Whether the unit is leasable or bookable is shown, derived from the product, not chosen.
- The unit is placed by dragging it on a live, to-scale preview (or with the arrow keys); the
  position fields only report where it is. Dropping it inside another space switches its Space.
- A unit that does not fit inside its space, or overlaps another unit, is flagged in words that name
  the space or the unit in the way — never by colour alone.

### US-G3 — Add a space
**As a** building manager
**I want to** draw a new space on an area of the floor that no other space covers
**So that** I can divide a floor for a new purpose — parking, coworking, tenants from one industry.

Acceptance criteria:
- Name and size are required; purpose is optional free text.
- The space is placed by dragging it on a live, to-scale preview among the floor's existing spaces
  and units (or with the arrow keys); the position fields only report where it is.
- A space that does not fit on the floor, or overlaps another space, is flagged in words naming
  what is in the way.
- A new space starts with no units.

### US-G4 — Shrink a space to make room
**As a** building manager
**I want to** shrink or move an existing space
**So that** I can free part of the floor for a new space, the way a disk is repartitioned.

Acceptance criteria:
- Name, purpose and size are editable and the space can be dragged to a new position; the current
  size and position are shown next to the new ones.
- A live, to-scale preview shows the space at its new size together with its own units.
- If any of the space's units would no longer lie fully inside it, each one is outlined and named,
  and Save is disabled — a layout with a unit outside every space can never be saved.
- The space form never moves or resizes units; the message says to move them first or keep the
  space larger.
- The space must stay on the floor and may not overlap another space.
- Delete is separated from Save.

### US-G5 — Change a unit that is leased
**As a** building manager
**I want to** move or resize a unit even while it is leased or booked
**So that** a refit does not have to wait for a tenancy to end.

Acceptance criteria:
- Size stays editable and the unit can be dragged to a new position, with the same live to-scale
  preview and fit/overlap checks as when adding a unit.
- While the unit has an active lease, its type and product are shown but locked, and the screen
  names the lease and says why.
- Delete is disabled while the unit has any lease or booking, and the reason — naming the lease or
  bookings to cancel first — is shown next to it, not only in a tooltip.
- The unit is reachable from its panel on the floor plan.

### US-G6 — Add a common area
**As a** building manager
**I want to** draw a corridor, kitchen, toilets or similar onto a floor
**So that** the floor plan shows the whole floor, not only what can be leased or booked.

Acceptance criteria:
- Name, kind and size are required; it is placed by dragging on a live, to-scale preview.
- It is never leased or booked, so it has no type, product or status.
- It may sit inside a space or outside every space, but must stay on the floor and may not overlap
  a unit or another common area — flagged in words naming what is in the way, with Create disabled.
- The floor's page lists its common areas with kind, position, size and area.

### US-G7 — Change a bookable unit's product
**As a** building manager
**I want to** change a bookable unit's product even while it has upcoming bookings
**So that** a refit or a repricing takes effect without cancelling anyone's booking.

Acceptance criteria:
- Type and product stay editable while the unit has bookings; the screen says how many upcoming
  bookings there are and that they keep the product and price they were made at.
- The unit's product history lists every product it has had, with its price and when it was in
  force, and which upcoming bookings still use an earlier one.
- Bookings already made never change product or price; new bookings use the new product.
- Delete is disabled while the unit has bookings, with the reason shown next to it.
- The unit is reachable from its panel on the floor plan.

### US-G8 — Make a floor or a space unavailable
**As a** building manager
**I want to** take one floor or one space out of use for a refit or repairs
**So that** nobody leases or books its units without closing the whole building.

Acceptance criteria:
- A floor is made unavailable from its row on the building, a space from its own form; both take a
  reason, a start date and an optional end date.
- Before confirming, the manager sees each booking in that period that will be cancelled and each
  active lease that will be flagged, with customers and tenants linked to their CRM records; the
  confirm button says it cancels bookings.
- While unavailable, units inside take no new leases or bookings; the area is drawn hatched in the
  warning tone with its reason and end date, and its units say they are unavailable.
- Confirming cancels those bookings (each customer notified) and flags those leases "Unit
  unavailable"; no lease is ended.

### US-G9 — Edit the floor I am looking at
**As a** building manager
**I want to** go from the floor plan straight to that floor's page and edit it
**So that** I can fix what I spot on the plan without going back through the building.

Acceptance criteria:
- The floor plan has an "Edit floor" action for the floor on screen.
- The floor's page edits its details — name, size, availability (the same Available switch) — and
  shows its layout drawn to scale, its spaces (a floor that was never divided shows its default
  "Whole floor" space), its units and its common areas, each list with its Available switches.
- Switching any availability off, in any list, opens the same dialog: reason (required), from,
  until, and what it touches.

### US-H1 — Browse today's bookable units and pick a free slot
**As a** customer
**I want to** see which units I can book have free time today and pick one
**So that** I can book it myself without contacting the building manager.

Acceptance criteria:
- A location control decides whose units are listed; a customer is not limited to the location they
  lease or hold a membership in.
- Every bookable unit at the location is listed, grouped by floor, naming its product and the space
  it is in.
- Every unit shows today's slots (hourly, or a whole day for a flex desk) within the building's
  opening hours, which are stated above the list; already-booked slots are visibly disabled and
  labelled as booked, not hidden.
- Units in an unavailable building, floor or space are not offered; an unavailable location is
  marked so in the location control.
- Every unit states its price in złoty.
- Selecting a free slot marks it as selected and enables continuing; the summary names what it will
  cost, and the selection can change before continuing.

### US-H2 — Review and confirm a booking
**As a** customer
**I want to** review the unit, where it is, the date and the time before confirming
**So that** I don't book the wrong slot or go to the wrong floor.

Acceptance criteria:
- The review restates the unit (with its product and size), floor, location, date and time exactly
  as selected.
- The review shows where the unit is on its floor, drawn to scale.
- It states the price in złoty.
- The customer can go back to change the slot; confirming is a single explicit action.

### US-H3 — See booking confirmation
**As a** customer
**I want to** get a clear confirmation once my booking is made
**So that** I know it succeeded and don't try to book it again.

Acceptance criteria:
- Confirmation restates unit, date and time, and what it costs.
- Confirmation offers a path back to the customer's bookings list.

### US-H4 — See my bookings
**As a** customer
**I want to** see my upcoming and past bookings in one place
**So that** I can keep track of what I've booked without re-checking my email.

Acceptance criteria:
- Upcoming and past bookings are visually distinguishable.
- Each booking names its unit and location; the list covers every location by default and can be
  filtered by location.
- Each booking states what it cost, in złoty.
- Booking a new unit is directly reachable from this list.

### US-I1 — See my current leases
**As a** tenant customer
**I want to** see every unit my company leases, with lease start and end dates, rate and a contact
**So that** I don't have to ask the building manager for terms I already agreed to.

Acceptance criteria:
- My leases lists every active lease of the customer's company, one card each.
- Each card shows the unit (name, floor, building), its product and size, lease start and end
  dates, and rate, and says so when the unit is currently unavailable (the lease continues).
- Lease detail is read-only — no edit or cancel affordance.

### US-I2 — See I have no active lease
**As a** customer who is not a tenant (e.g. a coworking member who only books)
**I want to** see a clear message instead of an empty or broken lease page
**So that** I understand I don't have a lease rather than assuming something failed to load.

Acceptance criteria:
- The no-lease state names the situation plainly, distinct from a loading or error state.
- It offers a next step (ask about leasing a unit) — illustrative only.

### US-I3 — See that my lease is running out
**As a** tenant customer
**I want to** see how long is left on a lease as soon as it gets close
**So that** I can plan around it instead of finding out when the notice arrives.

Acceptance criteria:
- A lease within the expiry threshold is flagged on the portal's lease screen, leading with the
  days remaining and the exact end date.
- The treatment matches what the manager sees for the same lease — same threshold, same warning
  tone, same countdown.

### US-I4 — Answer an extension proposal
**As a** tenant customer
**I want to** see the terms Acme Corp is proposing to extend on, and approve or decline them
**So that** I can settle it in one place instead of an email thread.

Acceptance criteria:
- The offer states the proposed term, the proposed rate including how it differs from the current
  one, and what else changes; it carries its own response deadline.
- Approve and decline are equally reachable, for users allowed to answer for the company.
- The screen states plainly that approving is binding: the lease is extended at once and the new
  rate applies from the new term.
- A declined proposal can still be approved until its deadline passes.

### US-I5 — Approve a lease proposal
**As a** customer's portal user
**I want to** see a lease Acme Corp proposes to my company — unit, product, term, rate — and approve
or decline it
**So that** we can take the space without paperwork going back and forth.

Acceptance criteria:
- Open proposals appear at the top of My leases, above the company's active leases, with their
  response deadline.
- Approve and decline need the permission to answer for the company; other users see the proposal
  read-only.
- Approving makes the lease active, creates its sales order and issues the first month's invoice;
  the screen says so before the click.
- Declining releases the unit; the proposal can still be approved until its deadline.

### US-J1 — See what needs my attention from anywhere in the portal
**As a** customer
**I want to** open one list of notifications from the portal header
**So that** I find out about my next booking or a waiting extension offer without checking each page.

Acceptance criteria:
- The bell sits in the portal header on every portal screen and carries the unread count; the panel
  header repeats it as a number.
- Unread is conveyed by more than colour — a bolder title and a marker on the row.
- Every notification opens the screen that resolves it: a booking opens My bookings, an extension
  offer opens My leases.
- Every fact a notification states matches the screen it links to; the list offers "mark all as
  read".

### US-J2 — See a calm empty state when nothing is pending
**As a** customer
**I want to** see a clear "nothing new" state rather than an empty panel
**So that** I know the bell is working and learn what it will tell me about.

Acceptance criteria:
- The bell shows no count badge when there is nothing unread.
- The empty state names the kinds of notification that will appear here.

### US-K1 — Configure billing and lead times
**As a** building manager
**I want to** choose the sales channel, the invoice issue day, the status for cancelled booking
orders, the lease-ending threshold and the booking reminder time in one place
**So that** leases and bookings turn into sales documents the way my organization bills, and every
warning uses the same numbers.

Acceptance criteria:
- Settings is reachable from the Facilities group in the sidebar.
- The sales channel has no default; until it is set, activating a lease or confirming a booking
  is refused with a message linking to Settings.
- The invoice issue day accepts 1–28 and applies in each building's time zone.
- The cancelled-booking status is chosen from the existing sales order statuses.
- Changing the lease-ending threshold changes the floor plan, Leases list, lease detail and portal
  warnings together.
- The proposal expiry (days) prefills the new-lease and extension proposal forms.

## Cross-cutting rules

- The customer portal is visually distinct chrome from the backend (top nav, not a sidebar), so a
  reviewer never confuses which surface a screen belongs to. The portal carries Acme Corp's logo lockup; the backend stays structurally the Open Mercato admin shell.
- This module contributes two entries to the portal's top nav, Bookings and My leases, alongside the
  inert Dashboard and Profile. The portal's other sections (Access, Events, Invoices, Support,
  Extras) belong to other modules and are left out of this prototype's nav; links into them surface
  the "not part of this prototype" toast.
- A location control in the portal reads the same way as the manager's building switcher — same
  control, same list of all 7 locations, same honest "illustrative" response when a reviewer
  picks an unmodeled one.
- Money in the customer portal is stated in złoty — a booking's price and a lease's rate alike.
- Company links are not repeated in the customer portal: a customer sees only their own company
  and has no CRM access.
- The portal bell is a dropdown panel, left of the account block, on every portal screen. A
  notification never restates a fact the portal does not already show, never ends anywhere but the
  screen that resolves it, and its unread count matches the panel's "N unread". Notification
  preferences are out of scope.
- Status must always be conveyed through shape/icon/label in addition to color (accessibility —
  no color-only meaning).
- A fact a customer and a manager both see is presented the same way on both sides. A lease
  expiring shows the same threshold, the same warning tone and the same countdown in the portal as
  on the floor plan, so neither side can think the other is less worried about it.
- The floor plan's three status colours are reserved: neutral = in active use (occupied/booked),
  success = ready for use (available/free), warning fill = blocked from use (unavailable). Anything
  else a tile needs to say — a lease ending soon, and whatever comes after it — is an annotation
  layered on top in a different channel (edge treatment, icon-marked badge), never a new fill
  colour, so the three statuses keep meaning exactly one thing each.
- Keyboard: every clickable office/bookable unit is reachable via Tab and activatable via
  Enter/Space; the detail panel traps focus while open and returns focus to the triggering unit on
  close.
- The floor plan and its detail panels are a read-only status view — leases are created and changed
  on the Leases screens, buildings and floors on the Buildings screens, and bookings in the customer
  portal. The bookings list is read-only too.
- All names shown are synthetic/fictional, including the coworking operator, the standard mock
  company **Acme Corp**: its 7 locations, the two Facilities bookable units ("Studio 2B,"
  "Huddle Room") and the product vocabulary ("Private office," "Company unit,"
  "Open space membership"). "Unit", "leasable unit" and "bookable unit" are this module's own terms
  (§Units); Acme Corp sells the bookable ones as "meeting rooms" — which is also the catalog
  category name used here.
- Every named individual (tenant contact, booking organizer) links to their CRM People record at
  `/backend/customers/people/[id]`, and every company name links to its CRM Company record at
  `/backend/customers/companies/[id]`. Those destinations are outside this prototype — clicking
  surfaces the standard "not part of this prototype" toast naming the real destination, rather than
  a dead link or a silent no-op. Person and company are linked independently. The one deliberate
  exception is the tenant name on a floor-plan unit tile, because the tile itself is the click
  target that opens that office — the company links from the office panel the tile opens instead.
- The backend sidebar carries only this module's Facilities group (Floor Plan, Buildings, Leases,
  Bookings, Settings); other modules' groups, including CRM, are left out for clarity. Buildings is the maintenance page behind the rest, and is
  reachable from that sidebar entry on every screen.
- Building names and addresses are made up, like every other name in this prototype.
- The prototype's review chrome is one floating bar: every control on it, and the screen inventory
  behind a menu whose top level is the sections and whose second level is that section's screens.
  This is prototype chrome, not a product requirement.
- The backoffice bell in the topbar is unchanged and unmodeled — notifications for a building
  manager are not covered here.

## Open questions surfaced while drafting (non-blocking)

- Should the bookable unit detail panel show upcoming bookings beyond today? Out of scope per the
  "today" framing in the brief.
