# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: packages/core/src/modules/customers/__integration__/TC-CRM-8286-unknown-activity-dates.spec.ts >> TC-CRM-8286: company Activities preserves unknown dates and entity scope
- Location: packages/core/src/modules/customers/__integration__/TC-CRM-8286-unknown-activity-dates.spec.ts:7:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText('Undated A 1793648044532-company', { exact: true }).locator('xpath=ancestor::div[@role="button"]/..').getByText('Unknown date', { exact: true })
Expected: 2
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for getByText('Undated A 1793648044532-company', { exact: true }).locator('xpath=ancestor::div[@role="button"]/..').getByText('Unknown date', { exact: true })
    43 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e5]:
    - link "Skip to main content" [ref=e6] [cursor=pointer]:
      - /url: "#main-content"
    - button "Toggle sidebar" [ref=e7]:
      - img [ref=e8]
    - complementary [ref=e11]:
      - generic [ref=e12]:
        - link "Go to dashboard" [ref=e14] [cursor=pointer]:
          - /url: /backend
          - img "Open Mercato" [ref=e15]
          - generic [ref=e16]: Open Mercato
        - generic [ref=e18]:
          - img [ref=e19]
          - searchbox "Search navigation" [ref=e22]
        - navigation [ref=e24]:
          - generic [ref=e25]:
            - button "Example" [expanded] [ref=e26] [cursor=pointer]:
              - generic [ref=e27]: Example
              - img
            - generic [ref=e28]:
              - link "Example Admin" [ref=e29] [cursor=pointer]:
                - /url: /backend/example
                - img [ref=e31]
                - generic [ref=e34]: Example Admin
              - link "Payment Gateway Demo" [ref=e35] [cursor=pointer]:
                - /url: /backend/payments
                - img [ref=e37]
                - generic [ref=e39]: Payment Gateway Demo
              - link "Phase A-D handlers" [ref=e40] [cursor=pointer]:
                - /url: /backend/umes-handlers
                - img [ref=e42]
                - generic [ref=e45]: Phase A-D handlers
              - link "UMES Next Phases" [ref=e46] [cursor=pointer]:
                - /url: /backend/umes-next-phases
                - img [ref=e48]
                - generic [ref=e51]: UMES Next Phases
              - link "Phase E-H handlers" [ref=e52] [cursor=pointer]:
                - /url: /backend/umes-extensions
                - img [ref=e54]
                - generic [ref=e58]: Phase E-H handlers
              - link "Phase L integrations" [ref=e59] [cursor=pointer]:
                - /url: /backend/umes-integrations
                - img [ref=e61]
                - generic [ref=e64]: Phase L integrations
              - link "Phase M — Mutation Lifecycle" [ref=e65] [cursor=pointer]:
                - /url: /backend/mutation-lifecycle
                - img [ref=e67]
                - generic [ref=e69]: Phase M — Mutation Lifecycle
              - link "Phase N query extensions" [ref=e70] [cursor=pointer]:
                - /url: /backend/umes-query-extensions
                - img [ref=e72]
                - generic [ref=e76]: Phase N query extensions
              - link "Example Todos" [ref=e77] [cursor=pointer]:
                - /url: /backend/todos
                - img [ref=e79]
                - generic [ref=e82]: Example Todos
          - generic [ref=e83]:
            - button "Customers" [expanded] [ref=e84] [cursor=pointer]:
              - generic [ref=e85]: Customers
              - img
            - generic [ref=e86]:
              - link "Calendar" [ref=e87] [cursor=pointer]:
                - /url: /backend/calendar
                - img [ref=e89]
                - generic [ref=e91]: Calendar
              - link "Companies" [ref=e92] [cursor=pointer]:
                - /url: /backend/customers/companies
                - img [ref=e95]
                - generic [ref=e99]: Companies
              - link "Create Company" [ref=e101] [cursor=pointer]:
                - /url: /backend/customers/companies/create
                - img [ref=e104]
                - generic [ref=e107]: Create Company
              - link "Customer related tasks" [ref=e108] [cursor=pointer]:
                - /url: /backend/customer-tasks
                - img [ref=e110]
                - generic [ref=e113]: Customer related tasks
              - link "Deals" [ref=e114] [cursor=pointer]:
                - /url: /backend/customers/deals
                - img [ref=e116]
                - generic [ref=e119]: Deals
              - link "People" [ref=e120] [cursor=pointer]:
                - /url: /backend/customers/people
                - img [ref=e122]
                - generic [ref=e127]: People
          - generic [ref=e128]:
            - button "Catalog" [expanded] [ref=e129] [cursor=pointer]:
              - generic [ref=e130]: Catalog
              - img
            - generic [ref=e131]:
              - link "Categories" [ref=e132] [cursor=pointer]:
                - /url: /backend/catalog/categories
                - img [ref=e134]
                - generic [ref=e139]: Categories
              - link "Price rules" [ref=e140] [cursor=pointer]:
                - /url: /backend/catalog/prices
                - img [ref=e142]
                - generic [ref=e145]: Price rules
              - link "Products & services" [ref=e146] [cursor=pointer]:
                - /url: /backend/catalog/products
                - img [ref=e148]
                - generic [ref=e152]: Products & services
          - generic [ref=e153]:
            - button "Sales" [expanded] [ref=e154] [cursor=pointer]:
              - generic [ref=e155]: Sales
              - img
            - generic [ref=e156]:
              - link "Create sales document" [ref=e157] [cursor=pointer]:
                - /url: /backend/sales/documents/create
                - img [ref=e159]
                - generic [ref=e162]: Create sales document
              - link "Orders" [ref=e163] [cursor=pointer]:
                - /url: /backend/sales/orders
                - img [ref=e165]
                - generic [ref=e168]: Orders
              - link "Quotes" [ref=e169] [cursor=pointer]:
                - /url: /backend/sales/quotes
                - img [ref=e171]
                - generic [ref=e175]: Quotes
              - link "Sales channels" [ref=e176] [cursor=pointer]:
                - /url: /backend/sales/channels
                - img [ref=e178]
                - generic [ref=e181]: Sales channels
          - generic [ref=e182]:
            - button "WMS" [expanded] [ref=e183] [cursor=pointer]:
              - generic [ref=e184]: WMS
              - img
            - link "Operational dashboard" [ref=e186] [cursor=pointer]:
              - /url: /backend/wms
              - img [ref=e188]
              - generic [ref=e191]: Operational dashboard
          - generic [ref=e192]:
            - button "Resource planning" [expanded] [ref=e193] [cursor=pointer]:
              - generic [ref=e194]: Resource planning
              - img
            - generic [ref=e195]:
              - link "Resource types" [ref=e196] [cursor=pointer]:
                - /url: /backend/resources/resource-types
                - img [ref=e198]
                - generic [ref=e203]: Resource types
              - link "Resources" [ref=e204] [cursor=pointer]:
                - /url: /backend/resources/resources
                - img [ref=e206]
                - generic [ref=e209]: Resources
          - generic [ref=e210]:
            - button "Employees" [expanded] [ref=e211] [cursor=pointer]:
              - generic [ref=e212]: Employees
              - img
            - generic [ref=e213]:
              - link "Teams" [ref=e214] [cursor=pointer]:
                - /url: /backend/staff/teams
                - img [ref=e216]
                - generic [ref=e221]: Teams
              - link "Team members" [ref=e222] [cursor=pointer]:
                - /url: /backend/staff/team-members
                - img [ref=e224]
                - generic [ref=e227]: Team members
              - link "Team roles" [ref=e228] [cursor=pointer]:
                - /url: /backend/staff/team-roles
                - img [ref=e230]
                - generic [ref=e233]: Team roles
              - link "Leave requests" [ref=e234] [cursor=pointer]:
                - /url: /backend/staff/leave-requests
                - img [ref=e236]
                - generic [ref=e239]: Leave requests
              - link "My leave requests" [ref=e240] [cursor=pointer]:
                - /url: /backend/staff/my-leave-requests
                - img [ref=e242]
                - generic [ref=e245]: My leave requests
              - link "My availability" [ref=e246] [cursor=pointer]:
                - /url: /backend/staff/my-availability
                - img [ref=e248]
                - generic [ref=e251]: My availability
          - generic [ref=e252]:
            - button "Time tracking" [expanded] [ref=e253] [cursor=pointer]:
              - generic [ref=e254]: Time tracking
              - img
            - link "My work" [ref=e256] [cursor=pointer]:
              - /url: /backend/staff/time-tracking
              - img [ref=e258]
              - generic [ref=e261]: My work
          - generic [ref=e262]:
            - button "Media" [expanded] [ref=e263] [cursor=pointer]:
              - generic [ref=e264]: Media
              - img
            - link "Attachments" [ref=e266] [cursor=pointer]:
              - /url: /backend/storage/attachments
              - img [ref=e268]
              - generic [ref=e271]: Attachments
          - generic [ref=e272]:
            - button "Automations" [expanded] [ref=e273] [cursor=pointer]:
              - generic [ref=e274]: Automations
              - img
            - generic [ref=e275]:
              - link "Automations" [ref=e276] [cursor=pointer]:
                - /url: /backend/definitions
                - img [ref=e278]
                - generic [ref=e282]: Automations
              - link "Automation Runs" [ref=e283] [cursor=pointer]:
                - /url: /backend/instances
                - img [ref=e285]
                - generic [ref=e287]: Automation Runs
              - link "Work Inbox" [ref=e288] [cursor=pointer]:
                - /url: /backend/work-inbox
                - img [ref=e290]
                - generic [ref=e293]: Work Inbox
              - link "Automation Events" [ref=e294] [cursor=pointer]:
                - /url: /backend/events
                - img [ref=e296]
                - generic [ref=e298]: Automation Events
          - generic [ref=e299]:
            - button "Communication" [expanded] [ref=e300] [cursor=pointer]:
              - generic [ref=e301]: Communication
              - img
            - link "Phone Calls" [ref=e303] [cursor=pointer]:
              - /url: /backend/phone_calls
              - img [ref=e305]
              - generic [ref=e309]: Phone Calls
          - generic [ref=e310]:
            - button "Compliance" [expanded] [ref=e311] [cursor=pointer]:
              - generic [ref=e312]: Compliance
              - img
            - link "EUDR Overview" [ref=e314] [cursor=pointer]:
              - /url: /backend/eudr
              - img [ref=e316]
              - generic [ref=e319]: EUDR Overview
          - generic [ref=e320]:
            - button "Customer Groups" [expanded] [ref=e321] [cursor=pointer]:
              - generic [ref=e322]: Customer Groups
              - img
            - link "Customer groups" [ref=e324] [cursor=pointer]:
              - /url: /backend/customer-groups
              - img [ref=e326]
              - generic [ref=e331]: Customer groups
          - generic [ref=e332]:
            - button "Promotions" [expanded] [ref=e333] [cursor=pointer]:
              - generic [ref=e334]: Promotions
              - img
            - generic [ref=e335]:
              - link "Promotions" [ref=e336] [cursor=pointer]:
                - /url: /backend/promotions
                - img [ref=e338]
                - generic [ref=e342]: Promotions
              - link "Promotional codes" [ref=e343] [cursor=pointer]:
                - /url: /backend/codes
                - img [ref=e345]
                - generic [ref=e347]: Promotional codes
          - generic [ref=e348]:
            - button "Operations" [expanded] [ref=e349] [cursor=pointer]:
              - generic [ref=e350]: Operations
              - img
            - link "Forms" [ref=e352] [cursor=pointer]:
              - /url: /backend/forms
              - img [ref=e355]
              - generic [ref=e357]: Forms
          - generic [ref=e358]:
            - button "Business Rules" [expanded] [ref=e359] [cursor=pointer]:
              - generic [ref=e360]: Business Rules
              - img
            - generic [ref=e361]:
              - link "Business Rules" [ref=e362] [cursor=pointer]:
                - /url: /backend/rules
                - img [ref=e364]
                - generic [ref=e367]: Business Rules
              - link "Rule Sets" [ref=e368] [cursor=pointer]:
                - /url: /backend/sets
                - img [ref=e370]
                - generic [ref=e374]: Rule Sets
              - link "Logs" [ref=e375] [cursor=pointer]:
                - /url: /backend/logs
                - img [ref=e377]
                - generic [ref=e379]: Logs
          - generic [ref=e380]:
            - button "Documents" [expanded] [ref=e381] [cursor=pointer]:
              - generic [ref=e382]: Documents
              - img
            - link "Documents" [ref=e384] [cursor=pointer]:
              - /url: /backend/documents
              - img [ref=e387]
              - generic [ref=e390]: Documents
          - generic [ref=e391]:
            - button "Warranty claims" [expanded] [ref=e392] [cursor=pointer]:
              - generic [ref=e393]: Warranty claims
              - img
            - link "Claims" [ref=e395] [cursor=pointer]:
              - /url: /backend/warranty_claims
              - img [ref=e397]
              - generic [ref=e400]: Claims
          - generic [ref=e401]:
            - button "AI Inbox Actions" [expanded] [ref=e402] [cursor=pointer]:
              - generic [ref=e403]: AI Inbox Actions
              - img
            - link "Proposals" [ref=e405] [cursor=pointer]:
              - /url: /backend/inbox-ops
              - img [ref=e407]
              - generic [ref=e410]: Proposals
          - generic [ref=e411]:
            - button "Checkout" [expanded] [ref=e412] [cursor=pointer]:
              - generic [ref=e413]: Checkout
              - img
            - generic [ref=e414]:
              - link "Pay Links" [ref=e415] [cursor=pointer]:
                - /url: /backend/checkout/pay-links
                - img [ref=e417]
                - generic [ref=e419]: Pay Links
              - link "Templates" [ref=e420] [cursor=pointer]:
                - /url: /backend/checkout/templates
                - img [ref=e422]
                - generic [ref=e425]: Templates
              - link "Transactions" [ref=e426] [cursor=pointer]:
                - /url: /backend/checkout/transactions
                - img [ref=e428]
                - generic [ref=e430]: Transactions
          - generic [ref=e431]:
            - button "Integrations" [expanded] [ref=e432] [cursor=pointer]:
              - generic [ref=e433]: Integrations
              - img
            - link "Communication Channels" [ref=e435] [cursor=pointer]:
              - /url: /backend/communication_channels/channels
              - img [ref=e437]
              - generic [ref=e440]: Communication Channels
          - generic [ref=e441]:
            - button "Work plan" [expanded] [ref=e442] [cursor=pointer]:
              - generic [ref=e443]: Work plan
              - img
            - link "General tasks" [ref=e445] [cursor=pointer]:
              - /url: /backend/todos
              - img [ref=e447]
              - generic [ref=e450]: General tasks
          - generic [ref=e451]:
            - button "Messages" [expanded] [ref=e452] [cursor=pointer]:
              - generic [ref=e453]: Messages
              - img
            - link "Messages" [ref=e455] [cursor=pointer]:
              - /url: /backend/messages
              - img [ref=e457]
              - generic [ref=e460]: Messages
      - button "Scroll to bottom" [ref=e461] [cursor=pointer]:
        - generic [ref=e462]:
          - img
    - generic [ref=e463]:
      - banner [ref=e464]:
        - navigation "Breadcrumb" [ref=e466]:
          - list [ref=e467]:
            - listitem [ref=e468]:
              - link "Dashboard" [ref=e469] [cursor=pointer]:
                - /url: /backend
                - img [ref=e470]
            - listitem [ref=e473]:
              - img [ref=e474]
            - listitem [ref=e476]:
              - generic "Companies" [ref=e477]
        - generic [ref=e478]:
          - button "Open AI assistant" [ref=e479] [cursor=pointer]:
            - img
            - generic [ref=e480]: AI
            - generic [ref=e481]: ⌘L
          - button "Open global search" [ref=e483] [cursor=pointer]:
            - img
          - 'button "Organization: Acme Corp" [ref=e484] [cursor=pointer]':
            - img
            - generic [ref=e485]: Acme Corp
            - img
          - link "Integrations" [ref=e487] [cursor=pointer]:
            - /url: /backend/integrations
            - img
          - link "Settings" [ref=e489] [cursor=pointer]:
            - /url: /backend/settings
            - img
          - link "Messages" [ref=e491] [cursor=pointer]:
            - /url: /backend/messages
            - img
          - button "Notifications" [ref=e492] [cursor=pointer]:
            - img
          - button "admin@acme.com" [ref=e494] [cursor=pointer]:
            - img
      - main [ref=e495]:
        - generic [ref=e499]:
          - generic [ref=e500]:
            - generic [ref=e501]:
              - generic [ref=e502]:
                - link "Back to companies" [ref=e503] [cursor=pointer]:
                  - /url: /backend/customers/companies
                  - generic [ref=e504]: ←
                  - generic [ref=e505]: Back to companies
                - generic [ref=e509] [cursor=pointer]:
                  - button "Unknown 1793648044532-company" [ref=e510]:
                    - paragraph [ref=e512]: Unknown 1793648044532-company
                  - button "Edit" [ref=e513]:
                    - img
              - generic [ref=e514]:
                - button "Compose message" [ref=e515] [cursor=pointer]:
                  - img
                - button "Version History" [ref=e516] [cursor=pointer]:
                  - img
                - button "Delete company" [ref=e517] [cursor=pointer]:
                  - img
                  - text: Delete company
            - generic [ref=e518]:
              - generic [ref=e520] [cursor=pointer]:
                - button "Primary email Not provided" [ref=e521]:
                  - paragraph [ref=e522]: Primary email
                  - paragraph [ref=e524]: Not provided
                - button "Edit" [ref=e525]:
                  - img
              - generic [ref=e527] [cursor=pointer]:
                - button "Primary phone Not provided" [ref=e528]:
                  - paragraph [ref=e529]: Primary phone
                  - paragraph [ref=e531]: Not provided
                - button "Edit" [ref=e532]:
                  - img
              - generic [ref=e534] [cursor=pointer]:
                - button "Status Not provided" [ref=e535]:
                  - paragraph [ref=e536]: Status
                  - generic [ref=e537]: Not provided
                - button "Edit" [ref=e538]:
                  - img
              - generic [ref=e539] [cursor=pointer]:
                - button "Edit" [ref=e540]:
                  - img
                - button "Next interaction Not provided" [ref=e541]:
                  - generic [ref=e542]:
                    - paragraph [ref=e543]: Next interaction
                    - generic [ref=e544]: Not provided
          - generic [ref=e545]:
            - tablist "Company detail sections" [ref=e548]:
              - tab "Notes" [ref=e549]:
                - generic [ref=e550]: Notes
              - tab "Activities" [selected] [ref=e551]:
                - generic [ref=e552]: Activities
              - tab "Deals" [ref=e553]:
                - generic [ref=e554]: Deals
              - tab "People" [ref=e555]:
                - generic [ref=e556]: People
              - tab "Addresses" [ref=e557]:
                - generic [ref=e558]: Addresses
              - tab "Tasks" [ref=e559]:
                - generic [ref=e560]: Tasks
            - generic [ref=e562]:
              - generic [ref=e563]:
                - img [ref=e564]
                - heading "Interaction history" [level=3] [ref=e567]
              - generic [ref=e568]:
                - img
                - searchbox "Search interaction history" [ref=e569]
                - generic: ⌘1
              - generic [ref=e570]:
                - generic [ref=e571]:
                  - button "All Activities" [pressed] [ref=e572] [cursor=pointer]:
                    - generic [ref=e573]: All Activities
                  - button "Note" [ref=e574] [cursor=pointer]:
                    - img
                    - generic [ref=e575]: Note
                  - button "Call 4" [ref=e576] [cursor=pointer]:
                    - img
                    - generic [ref=e577]: Call 4
                  - button "Meeting" [ref=e578] [cursor=pointer]:
                    - img
                    - generic [ref=e579]: Meeting
                  - button "Email" [ref=e580] [cursor=pointer]:
                    - img
                    - generic [ref=e581]: Email
                  - button "Task" [ref=e582] [cursor=pointer]:
                    - img
                    - generic [ref=e583]: Task
                - button "More" [ref=e584] [cursor=pointer]:
                  - img
              - generic [ref=e585]:
                - generic [ref=e587]:
                  - generic [ref=e588]:
                    - generic [ref=e589]: Feb 2
                    - generic [ref=e590]: 01:00 PM
                  - img [ref=e592]
                  - generic [ref=e594]:
                    - generic [ref=e597]: Newer 1793648044532-company
                    - generic [ref=e598]:
                      - img [ref=e599]
                      - generic [ref=e602]: by admin@acme.com
                    - generic [ref=e603]:
                      - generic [ref=e604]: "AI:"
                      - button "Summarize" [ref=e605] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e606] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e607] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e608] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e610]:
                  - generic [ref=e611]:
                    - generic [ref=e612]: Jan 2
                    - generic [ref=e613]: 01:00 PM
                  - img [ref=e615]
                  - generic [ref=e617]:
                    - generic [ref=e620]: Older 1793648044532-company
                    - generic [ref=e621]:
                      - img [ref=e622]
                      - generic [ref=e625]: by admin@acme.com
                    - generic [ref=e626]:
                      - generic [ref=e627]: "AI:"
                      - button "Summarize" [ref=e628] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e629] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e630] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e631] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e633]:
                  - generic [ref=e635]: Unknown date
                  - img [ref=e637]
                  - generic [ref=e639]:
                    - generic [ref=e642]: Undated A 1793648044532-company
                    - generic [ref=e643]:
                      - img [ref=e644]
                      - generic [ref=e647]: by admin@acme.com
                    - generic [ref=e648]:
                      - generic [ref=e649]: "AI:"
                      - button "Summarize" [ref=e650] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e651] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e652] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e653] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e655]:
                  - generic [ref=e657]: Unknown date
                  - img [ref=e659]
                  - generic [ref=e661]:
                    - generic [ref=e664]: Undated B 1793648044532-company
                    - generic [ref=e665]:
                      - img [ref=e666]
                      - generic [ref=e669]: by admin@acme.com
                    - generic [ref=e670]:
                      - generic [ref=e671]: "AI:"
                      - button "Summarize" [ref=e672] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e673] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e674] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e675] [cursor=pointer]:
                        - img
                        - text: Action items
              - generic [ref=e677]: See all 4 activities
          - generic [ref=e678]:
            - generic [ref=e679]:
              - heading "Company details" [level=2] [ref=e680]
              - generic [ref=e682]:
                - generic [ref=e685] [cursor=pointer]:
                  - button "Display name Unknown 1793648044532-company" [ref=e686]:
                    - paragraph [ref=e687]: Display name
                    - paragraph [ref=e689]: Unknown 1793648044532-company
                  - button "Edit" [ref=e690]:
                    - img
                - generic [ref=e693] [cursor=pointer]:
                  - button "Legal name Not provided" [ref=e694]:
                    - paragraph [ref=e695]: Legal name
                    - paragraph [ref=e697]: Not provided
                  - button "Edit" [ref=e698]:
                    - img
                - generic [ref=e701] [cursor=pointer]:
                  - button "Brand name Not provided" [ref=e702]:
                    - paragraph [ref=e703]: Brand name
                    - paragraph [ref=e705]: Not provided
                  - button "Edit" [ref=e706]:
                    - img
                - generic [ref=e709] [cursor=pointer]:
                  - button "Description Not provided" [ref=e710]:
                    - paragraph [ref=e711]: Description
                    - generic [ref=e712]: Not provided
                  - button "Edit" [ref=e713]:
                    - img
                - generic [ref=e716] [cursor=pointer]:
                  - button "Lifecycle stage Not provided" [ref=e717]:
                    - paragraph [ref=e718]: Lifecycle stage
                    - generic [ref=e719]: Not provided
                  - button "Edit" [ref=e720]:
                    - img
                - generic [ref=e723] [cursor=pointer]:
                  - button "Source Not provided" [ref=e724]:
                    - paragraph [ref=e725]: Source
                    - generic [ref=e726]: Not provided
                  - button "Edit" [ref=e727]:
                    - img
                - generic [ref=e730] [cursor=pointer]:
                  - button "Domain Not provided" [ref=e731]:
                    - paragraph [ref=e732]: Domain
                    - paragraph [ref=e734]: Not provided
                  - button "Edit" [ref=e735]:
                    - img
                - generic [ref=e738] [cursor=pointer]:
                  - button "Industry Not provided" [ref=e739]:
                    - paragraph [ref=e740]: Industry
                    - generic [ref=e741]: Not provided
                  - button "Edit" [ref=e742]:
                    - img
                - generic [ref=e745] [cursor=pointer]:
                  - button "Company size Not provided" [ref=e746]:
                    - paragraph [ref=e747]: Company size
                    - paragraph [ref=e749]: Not provided
                  - button "Edit" [ref=e750]:
                    - img
                - button "Annual revenue Not provided Edit" [ref=e752] [cursor=pointer]:
                  - generic [ref=e753]:
                    - generic [ref=e754]:
                      - paragraph [ref=e755]: Annual revenue
                      - paragraph [ref=e757]: Not provided
                    - button "Edit" [ref=e758]:
                      - img
                      - generic [ref=e759]: Edit
                - generic [ref=e762] [cursor=pointer]:
                  - button "Website Not provided" [ref=e763]:
                    - paragraph [ref=e764]: Website
                    - paragraph [ref=e766]: Not provided
                  - button "Edit" [ref=e767]:
                    - img
              - generic [ref=e768]:
                - generic [ref=e769]:
                  - generic [ref=e770]:
                    - heading "Related documents" [level=3] [ref=e771]
                    - generic [ref=e772]: "0"
                  - generic [ref=e773]:
                    - button "Link existing" [ref=e774] [cursor=pointer]:
                      - img
                      - text: Link existing
                    - button "New from template" [ref=e775] [cursor=pointer]:
                      - img
                      - text: New from template
                - generic [ref=e777]:
                  - img [ref=e779]
                  - paragraph [ref=e783]: No accessible documents are related to this record.
            - generic [ref=e785]:
              - generic [ref=e786]:
                - heading "Custom fields" [level=2] [ref=e787]
                - button "Edit" [ref=e788] [cursor=pointer]:
                  - img
                  - generic [ref=e789]: Edit
              - button "Relationship health Not set Renewal quarter Not set Executive notes Not set Marketing case study ready Not set" [ref=e791] [cursor=pointer]:
                - generic [ref=e792]:
                  - paragraph [ref=e793]: Relationship health
                  - generic [ref=e794]: Not set
                - generic [ref=e795]:
                  - paragraph [ref=e796]: Renewal quarter
                  - generic [ref=e797]: Not set
                - generic [ref=e798]:
                  - paragraph [ref=e799]: Executive notes
                  - generic [ref=e800]: Not set
                - generic [ref=e801]:
                  - paragraph [ref=e802]: Marketing case study ready
                  - generic [ref=e803]: Not set
            - generic [ref=e805]:
              - generic [ref=e806]:
                - heading "Tags" [level=2] [ref=e807]
                - paragraph [ref=e808]: Tags save automatically after each change.
              - textbox "Type to add tags" [ref=e814]
          - separator [ref=e815]
      - contentinfo [ref=e816]:
        - generic [ref=e817]: Version 0.10.0
        - navigation [ref=e818]:
          - link "Terms" [ref=e819] [cursor=pointer]:
            - /url: /terms
          - link "Privacy" [ref=e820] [cursor=pointer]:
            - /url: /privacy
  - alert [ref=e822]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { login } from '@open-mercato/core/helpers/integration/auth'
  3  | import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
  4  | import { createCompanyFixture, createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
  5  | 
  6  | for (const kind of ['person', 'company'] as const) {
  7  |   test(`TC-CRM-8286: ${kind} Activities preserves unknown dates and entity scope`, async ({ page, request }) => {
  8  |     test.setTimeout(90_000)
  9  |     const token = await getAuthToken(request, 'admin')
  10 |     const stamp = `${Date.now()}-${kind}`
  11 |     const interactionIds: string[] = []
  12 |     let entityId: string | null = null
  13 |     let otherId: string | null = null
  14 |     const entityPath = kind === 'person' ? '/api/customers/people' : '/api/customers/companies'
  15 |     try {
  16 |       entityId = kind === 'person'
  17 |         ? await createPersonFixture(request, token, { firstName: 'Unknown', lastName: stamp, displayName: `Unknown ${stamp}` })
  18 |         : await createCompanyFixture(request, token, `Unknown ${stamp}`)
  19 |       otherId = await createCompanyFixture(request, token, `Other ${stamp}`)
  20 |       const fixtures = [
  21 |         { title: `Undated A ${stamp}`, occurredAt: null, entityId },
  22 |         { title: `Older ${stamp}`, occurredAt: '2020-01-02T12:00:00.000Z', entityId },
  23 |         { title: `Undated B ${stamp}`, occurredAt: null, entityId },
  24 |         { title: `Newer ${stamp}`, occurredAt: '2020-02-02T12:00:00.000Z', entityId },
  25 |         { title: `Other ${stamp}`, occurredAt: null, entityId: otherId },
  26 |       ]
  27 |       for (const fixture of fixtures) {
  28 |         const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
  29 |           token, data: { ...fixture, interactionType: 'call', status: 'done', scheduledAt: null },
  30 |         })
  31 |         expect(response.ok()).toBeTruthy()
  32 |         const payload = await readJsonSafe<{ id: string }>(response)
  33 |         expect(payload?.id).toBeTruthy()
  34 |         interactionIds.push(payload!.id)
  35 |       }
  36 |       const response = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${entityId}&limit=100`, { token })
  37 |       expect(response.ok()).toBeTruthy()
  38 |       const payload = await readJsonSafe<{ items: Array<{ id: string; occurredAt: string | null; createdAt: string; entityId: string }> }>(response)
  39 |       expect(payload?.items.map((item) => item.id).sort()).toEqual(interactionIds.slice(0, 4).sort())
  40 |       for (const index of [0, 2]) {
  41 |         const row = payload?.items.find((item) => item.id === interactionIds[index])
  42 |         expect(row?.occurredAt).toBeNull()
  43 |         expect(row?.createdAt).toBeTruthy()
  44 |       }
  45 |       const unauthenticated = await page.request.get(`/api/customers/interactions?entityId=${entityId}`)
  46 |       expect(unauthenticated.status()).toBe(401)
  47 |       await login(page, 'admin')
  48 |       await page.goto(`/backend/customers/${kind === 'person' ? 'people' : 'companies'}/${entityId}?tab=activities`)
  49 |       const activitiesTab = page.getByRole('tab', { name: /^Activities$/i })
  50 |       if (await activitiesTab.count()) await activitiesTab.click()
  51 |       await expect(page.getByText(fixtures[0].title, { exact: true })).toBeVisible()
  52 |       const timeline = page.getByText(fixtures[0].title, { exact: true }).locator('xpath=ancestor::div[@role="button"]/..')
> 53 |       await expect(timeline.getByText('Unknown date', { exact: true })).toHaveCount(2)
     |                                                                         ^ Error: expect(locator).toHaveCount(expected) failed
  54 |       const expectedUndatedIds = [interactionIds[0], interactionIds[2]].sort().reverse()
  55 |       const expectedTitles = [fixtures[3].title, fixtures[1].title, ...expectedUndatedIds.map((id) => fixtures[interactionIds.indexOf(id)].title)]
  56 |       const displayedTitles = (await timeline.getByRole('button').allTextContents()).filter((text) => fixtures.some((fixture) => text.includes(fixture.title)))
  57 |       expect(displayedTitles.map((text) => fixtures.find((fixture) => text.includes(fixture.title))?.title)).toEqual(expectedTitles)
  58 |       await expect(page.getByText(fixtures[4].title, { exact: true })).toHaveCount(0)
  59 |       await page.screenshot({ path: test.info().outputPath(`${kind}-unknown-activity-dates.png`), fullPage: true })
  60 |     } finally {
  61 |       for (const id of interactionIds.reverse()) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
  62 |       await deleteEntityIfExists(request, token, entityPath, entityId)
  63 |       await deleteEntityIfExists(request, token, '/api/customers/companies', otherId)
  64 |     }
  65 |   })
  66 | }
  67 | 
```