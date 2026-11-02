# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: packages/core/src/modules/customers/__integration__/TC-CRM-8286-unknown-activity-dates.spec.ts >> TC-CRM-8286: person Activities preserves unknown dates and entity scope
- Location: packages/core/src/modules/customers/__integration__/TC-CRM-8286-unknown-activity-dates.spec.ts:7:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByText('Undated A 1793647985399-person', { exact: true }).locator('xpath=ancestor::div[@role="button"]/..').getByText('Unknown date', { exact: true })
Expected: 2
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" with timeout 20000ms
  - waiting for getByText('Undated A 1793647985399-person', { exact: true }).locator('xpath=ancestor::div[@role="button"]/..').getByText('Unknown date', { exact: true })
    44 × locator resolved to 0 elements
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
                - img [ref=e94]
                - generic [ref=e98]: Companies
              - link "Customer related tasks" [ref=e99] [cursor=pointer]:
                - /url: /backend/customer-tasks
                - img [ref=e101]
                - generic [ref=e104]: Customer related tasks
              - link "Deals" [ref=e105] [cursor=pointer]:
                - /url: /backend/customers/deals
                - img [ref=e107]
                - generic [ref=e110]: Deals
              - link "People" [ref=e111] [cursor=pointer]:
                - /url: /backend/customers/people
                - img [ref=e114]
                - generic [ref=e119]: People
              - link "Create Person" [ref=e121] [cursor=pointer]:
                - /url: /backend/customers/people/create
                - img [ref=e124]
                - generic [ref=e127]: Create Person
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
              - generic "People" [ref=e477]
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
        - generic [ref=e498]:
          - generic [ref=e499]:
            - generic [ref=e500]:
              - generic [ref=e501]:
                - link "Back to people" [ref=e502] [cursor=pointer]:
                  - /url: /backend/customers/people
                  - generic [ref=e503]: ←
                  - generic [ref=e504]: Back to people
                - generic [ref=e508] [cursor=pointer]:
                  - button "Unknown 1793647985399-person" [ref=e509]:
                    - paragraph [ref=e511]: Unknown 1793647985399-person
                  - button "Edit" [ref=e512]:
                    - img
              - generic [ref=e513]:
                - button "Compose message" [ref=e514] [cursor=pointer]:
                  - img
                - button "Version History" [ref=e515] [cursor=pointer]:
                  - img
                - button "Delete" [ref=e516] [cursor=pointer]:
                  - img
                  - text: Delete
            - generic [ref=e518]:
              - generic [ref=e519]:
                - paragraph [ref=e520]:
                  - img [ref=e521]
                  - text: Company
                - generic [ref=e526]: No company assigned
              - button "Edit" [ref=e527] [cursor=pointer]:
                - img
                - generic [ref=e528]: Edit
            - generic [ref=e529]:
              - generic [ref=e531] [cursor=pointer]:
                - button "Primary email Not set" [ref=e532]:
                  - paragraph [ref=e533]: Primary email
                  - paragraph [ref=e535]: Not set
                - button "Edit" [ref=e536]:
                  - img
              - generic [ref=e538] [cursor=pointer]:
                - button "Primary phone Not set" [ref=e539]:
                  - paragraph [ref=e540]: Primary phone
                  - paragraph [ref=e542]: Not set
                - button "Edit" [ref=e543]:
                  - img
              - generic [ref=e545] [cursor=pointer]:
                - button "Status Not set" [ref=e546]:
                  - paragraph [ref=e547]: Status
                  - generic [ref=e548]: Not set
                - button "Edit" [ref=e549]:
                  - img
              - generic [ref=e550] [cursor=pointer]:
                - button "Edit" [ref=e551]:
                  - img
                - button "Next interaction Not set" [ref=e552]:
                  - generic [ref=e553]:
                    - paragraph [ref=e554]: Next interaction
                    - generic [ref=e555]: Not set
          - generic [ref=e556]:
            - tablist "Person detail sections" [ref=e559]:
              - tab "Notes" [ref=e560]:
                - generic [ref=e561]: Notes
              - tab "Activities" [selected] [ref=e562]:
                - generic [ref=e563]: Activities
              - tab "Deals" [ref=e564]:
                - generic [ref=e565]: Deals
              - tab "Addresses" [ref=e566]:
                - generic [ref=e567]: Addresses
              - tab "Tasks" [ref=e568]:
                - generic [ref=e569]: Tasks
            - generic [ref=e571]:
              - generic [ref=e572]:
                - img [ref=e573]
                - heading "Interaction history" [level=3] [ref=e576]
              - generic [ref=e577]:
                - img
                - searchbox "Search interaction history" [ref=e578]
                - generic: ⌘1
              - generic [ref=e579]:
                - generic [ref=e580]:
                  - button "All Activities" [pressed] [ref=e581] [cursor=pointer]:
                    - generic [ref=e582]: All Activities
                  - button "Note" [ref=e583] [cursor=pointer]:
                    - img
                    - generic [ref=e584]: Note
                  - button "Call 4" [ref=e585] [cursor=pointer]:
                    - img
                    - generic [ref=e586]: Call 4
                  - button "Meeting" [ref=e587] [cursor=pointer]:
                    - img
                    - generic [ref=e588]: Meeting
                  - button "Email" [ref=e589] [cursor=pointer]:
                    - img
                    - generic [ref=e590]: Email
                  - button "Task" [ref=e591] [cursor=pointer]:
                    - img
                    - generic [ref=e592]: Task
                - button "More" [ref=e593] [cursor=pointer]:
                  - img
              - generic [ref=e594]:
                - generic [ref=e596]:
                  - generic [ref=e597]:
                    - generic [ref=e598]: Feb 2
                    - generic [ref=e599]: 01:00 PM
                  - img [ref=e601]
                  - generic [ref=e603]:
                    - generic [ref=e606]: Newer 1793647985399-person
                    - generic [ref=e607]:
                      - img [ref=e608]
                      - generic [ref=e611]: by admin@acme.com
                    - generic [ref=e612]:
                      - generic [ref=e613]: "AI:"
                      - button "Summarize" [ref=e614] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e615] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e616] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e617] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e619]:
                  - generic [ref=e620]:
                    - generic [ref=e621]: Jan 2
                    - generic [ref=e622]: 01:00 PM
                  - img [ref=e624]
                  - generic [ref=e626]:
                    - generic [ref=e629]: Older 1793647985399-person
                    - generic [ref=e630]:
                      - img [ref=e631]
                      - generic [ref=e634]: by admin@acme.com
                    - generic [ref=e635]:
                      - generic [ref=e636]: "AI:"
                      - button "Summarize" [ref=e637] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e638] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e639] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e640] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e642]:
                  - generic [ref=e644]: Unknown date
                  - img [ref=e646]
                  - generic [ref=e648]:
                    - generic [ref=e651]: Undated A 1793647985399-person
                    - generic [ref=e652]:
                      - img [ref=e653]
                      - generic [ref=e656]: by admin@acme.com
                    - generic [ref=e657]:
                      - generic [ref=e658]: "AI:"
                      - button "Summarize" [ref=e659] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e660] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e661] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e662] [cursor=pointer]:
                        - img
                        - text: Action items
                - generic [ref=e664]:
                  - generic [ref=e666]: Unknown date
                  - img [ref=e668]
                  - generic [ref=e670]:
                    - generic [ref=e673]: Undated B 1793647985399-person
                    - generic [ref=e674]:
                      - img [ref=e675]
                      - generic [ref=e678]: by admin@acme.com
                    - generic [ref=e679]:
                      - generic [ref=e680]: "AI:"
                      - button "Summarize" [ref=e681] [cursor=pointer]:
                        - img
                        - text: Summarize
                      - button "Replay" [ref=e682] [cursor=pointer]:
                        - img
                        - text: Replay
                      - button "Transcription" [ref=e683] [cursor=pointer]:
                        - img
                        - text: Transcription
                      - button "Action items" [ref=e684] [cursor=pointer]:
                        - img
                        - text: Action items
              - generic [ref=e686]: See all 4 activities
          - generic [ref=e687]:
            - generic [ref=e688]:
              - heading "Details" [level=2] [ref=e689]
              - generic [ref=e691]:
                - generic [ref=e694] [cursor=pointer]:
                  - button "Display name Unknown 1793647985399-person" [ref=e695]:
                    - paragraph [ref=e696]: Display name
                    - paragraph [ref=e698]: Unknown 1793647985399-person
                  - button "Edit" [ref=e699]:
                    - img
                - generic [ref=e702] [cursor=pointer]:
                  - button "First name Unknown" [ref=e703]:
                    - paragraph [ref=e704]: First name
                    - paragraph [ref=e706]: Unknown
                  - button "Edit" [ref=e707]:
                    - img
                - generic [ref=e710] [cursor=pointer]:
                  - button "Last name 1793647985399-person" [ref=e711]:
                    - paragraph [ref=e712]: Last name
                    - paragraph [ref=e714]: 1793647985399-person
                  - button "Edit" [ref=e715]:
                    - img
                - generic [ref=e718] [cursor=pointer]:
                  - button "Job title Not set" [ref=e719]:
                    - paragraph [ref=e720]: Job title
                    - generic [ref=e721]: Not set
                  - button "Edit" [ref=e722]:
                    - img
                - generic [ref=e725] [cursor=pointer]:
                  - button "Lifecycle stage Not set" [ref=e726]:
                    - paragraph [ref=e727]: Lifecycle stage
                    - generic [ref=e728]: Not set
                  - button "Edit" [ref=e729]:
                    - img
                - generic [ref=e732] [cursor=pointer]:
                  - button "Source Not set" [ref=e733]:
                    - paragraph [ref=e734]: Source
                    - generic [ref=e735]: Not set
                  - button "Edit" [ref=e736]:
                    - img
                - generic [ref=e739] [cursor=pointer]:
                  - button "Description Not set" [ref=e740]:
                    - paragraph [ref=e741]: Description
                    - generic [ref=e742]: Not set
                  - button "Edit" [ref=e743]:
                    - img
                - generic [ref=e746] [cursor=pointer]:
                  - button "Department Not set" [ref=e747]:
                    - paragraph [ref=e748]: Department
                    - paragraph [ref=e750]: Not set
                  - button "Edit" [ref=e751]:
                    - img
                - generic [ref=e754] [cursor=pointer]:
                  - button "LinkedIn Not set" [ref=e755]:
                    - paragraph [ref=e756]: LinkedIn
                    - generic [ref=e757]: Not set
                  - button "Edit" [ref=e758]:
                    - img
                - generic [ref=e761] [cursor=pointer]:
                  - button "Twitter Not set" [ref=e762]:
                    - paragraph [ref=e763]: Twitter
                    - generic [ref=e764]: Not set
                  - button "Edit" [ref=e765]:
                    - img
              - generic [ref=e766]:
                - generic [ref=e767]:
                  - generic [ref=e768]:
                    - heading "Related documents" [level=3] [ref=e769]
                    - generic [ref=e770]: "0"
                  - generic [ref=e771]:
                    - button "Link existing" [ref=e772] [cursor=pointer]:
                      - img
                      - text: Link existing
                    - button "New from template" [ref=e773] [cursor=pointer]:
                      - img
                      - text: New from template
                - generic [ref=e775]:
                  - img [ref=e777]
                  - paragraph [ref=e781]: No accessible documents are related to this record.
              - generic [ref=e782]:
                - generic [ref=e783]: Customer priority
                - generic [ref=e784]: Set priority for this customer record.
                - combobox [ref=e785]:
                  - generic:
                    - generic: Normal
                  - img
            - generic [ref=e787]:
              - generic [ref=e788]:
                - heading "Custom data" [level=2] [ref=e789]
                - button "Edit" [ref=e790] [cursor=pointer]:
                  - img
                  - generic [ref=e791]: Edit
              - button "Preferred pronouns Not set Buying role Not set Newsletter opt-in Not set" [ref=e793] [cursor=pointer]:
                - generic [ref=e794]:
                  - paragraph [ref=e795]: Preferred pronouns
                  - generic [ref=e796]: Not set
                - generic [ref=e797]:
                  - paragraph [ref=e798]: Buying role
                  - generic [ref=e799]: Not set
                - generic [ref=e800]:
                  - paragraph [ref=e801]: Newsletter opt-in
                  - generic [ref=e802]: Not set
            - generic [ref=e804]:
              - generic [ref=e805]:
                - heading "Tags" [level=2] [ref=e806]
                - paragraph [ref=e807]: Tags save automatically after each change.
              - textbox "Type to add tags" [ref=e813]
      - contentinfo [ref=e814]:
        - generic [ref=e815]: Version 0.10.0
        - navigation [ref=e816]:
          - link "Terms" [ref=e817] [cursor=pointer]:
            - /url: /terms
          - link "Privacy" [ref=e818] [cursor=pointer]:
            - /url: /privacy
  - alert [ref=e820]
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