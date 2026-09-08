import * as React from 'react'
import { CircleCheck, Rocket, Sparkles } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// `FlashMessages` itself is a singleton mounted by AppShell — the gallery only
// demonstrates the imperative `flash()` API; the triggered toast renders
// through the already-mounted singleton.
const flashMessagesEntry: GalleryEntry = {
  id: 'flash-messages',
  title: 'FlashMessages',
  importPath: '@open-mercato/ui/backend/FlashMessages',
  variants: [
    {
      id: 'kinds',
      title: 'flash() kinds (toast via the AppShell singleton)',
      render: () => (
        <>
          <Button variant="outline" onClick={() => flash('Changes saved', 'success')}>
            Fire success
          </Button>
          <Button variant="outline" onClick={() => flash('Sync scheduled', 'info')}>
            Fire info
          </Button>
          <Button variant="outline" onClick={() => flash('Quota almost reached', 'warning')}>
            Fire warning
          </Button>
          <Button variant="outline" onClick={() => flash('Save failed', 'error')}>
            Fire error
          </Button>
        </>
      ),
      code: `import { flash } from '@open-mercato/ui/backend/FlashMessages'

// FlashMessages is mounted once by AppShell — never mount your own.
flash('Changes saved', 'success')
flash('Sync scheduled', 'info')
flash('Quota almost reached', 'warning')
flash('Save failed', 'error')`,
    },
  ],
}

const nextStepCalloutEntry: GalleryEntry = {
  id: 'next-step-callout',
  title: 'NextStepCallout',
  importPath: '@open-mercato/ui/backend/NextStepCallout',
  variants: [
    {
      id: 'basic',
      title: 'Basic',
      render: () => (
        <div className="w-full">
          <NextStepCallout
            icon={<Rocket className="size-6" />}
            title="Publish your catalog"
            description="Products are imported and priced. Publishing makes them visible on every sales channel."
            actionLabel="Publish catalog"
            actionIcon={<Sparkles className="mr-2 size-4" />}
            onAction={() => {}}
          />
        </div>
      ),
      code: `import { Rocket, Sparkles } from 'lucide-react'
import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'

<NextStepCallout
  icon={<Rocket className="size-6" />}
  title="Publish your catalog"
  description="Products are imported and priced. Publishing makes them visible on every sales channel."
  actionLabel="Publish catalog"
  actionIcon={<Sparkles className="mr-2 size-4" />}
  onAction={handlePublish}
/>`,
    },
    {
      id: 'with-steps',
      title: 'With steps',
      render: () => (
        <div className="w-full">
          <NextStepCallout
            title="Finish store setup"
            description="Two steps are done — connect a payment provider to start selling."
            steps={[
              { id: 'import', label: 'Import products', state: 'completed' },
              { id: 'pricing', label: 'Set pricing', state: 'completed' },
              { id: 'payments', label: 'Connect payments', state: 'active' },
              { id: 'launch', label: 'Launch', state: 'pending' },
            ]}
            actionLabel="Connect payments"
            onAction={() => {}}
          />
        </div>
      ),
      code: `import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'

<NextStepCallout
  title="Finish store setup"
  description="Two steps are done — connect a payment provider to start selling."
  steps={[
    { id: 'import', label: 'Import products', state: 'completed' },
    { id: 'pricing', label: 'Set pricing', state: 'completed' },
    { id: 'payments', label: 'Connect payments', state: 'active' },
    { id: 'launch', label: 'Launch', state: 'pending' },
  ]}
  actionLabel="Connect payments"
  onAction={handleConnect}
/>`,
    },
    {
      id: 'with-status',
      title: 'With status progress',
      render: () => (
        <div className="w-full">
          <NextStepCallout
            title="Index your products"
            description="Search stays disabled until the first indexing run completes."
            actionLabel="Re-run indexing"
            onAction={() => {}}
            busy
            status={{
              tone: 'info',
              icon: <CircleCheck className="size-4" />,
              label: 'Indexing in progress',
              progressValue: 64,
              progressDescription: '1,280 of 2,000 products indexed',
            }}
          />
        </div>
      ),
      code: `import { CircleCheck } from 'lucide-react'
import { NextStepCallout } from '@open-mercato/ui/backend/NextStepCallout'

<NextStepCallout
  title="Index your products"
  description="Search stays disabled until the first indexing run completes."
  actionLabel="Re-run indexing"
  onAction={handleReindex}
  busy
  status={{
    tone: 'info',
    icon: <CircleCheck className="size-4" />,
    label: 'Indexing in progress',
    progressValue: 64,
    progressDescription: '1,280 of 2,000 products indexed',
  }}
/>`,
    },
  ],
}

const contextHelpEntry: GalleryEntry = {
  id: 'context-help',
  title: 'ContextHelp',
  importPath: '@open-mercato/ui/backend/ContextHelp',
  variants: [
    {
      id: 'default',
      title: 'default (collapsed)',
      render: () => (
        <div className="w-full max-w-md">
          <ContextHelp title="How do exchange rates work?">
            Rates refresh nightly from the configured provider. Manual overrides
            stay pinned until you clear them.
          </ContextHelp>
        </div>
      ),
      code: `import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'

<ContextHelp title="How do exchange rates work?">
  Rates refresh nightly from the configured provider. Manual overrides
  stay pinned until you clear them.
</ContextHelp>`,
    },
    {
      id: 'default-open',
      title: 'defaultOpen',
      render: () => (
        <div className="w-full max-w-md">
          <ContextHelp title="Why is this field required?" defaultOpen>
            The tax office identifier is mandatory for invoices issued to
            companies registered in the EU.
          </ContextHelp>
        </div>
      ),
      code: `import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'

<ContextHelp title="Why is this field required?" defaultOpen>
  The tax office identifier is mandatory for invoices issued to
  companies registered in the EU.
</ContextHelp>`,
    },
    {
      id: 'info-icon',
      title: 'Info icon (bulb={false})',
      render: () => (
        <div className="w-full max-w-md">
          <ContextHelp title="About draft orders" bulb={false} defaultOpen>
            Draft orders are invisible to customers and skip stock reservation
            until they are confirmed.
          </ContextHelp>
        </div>
      ),
      code: `import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'

<ContextHelp title="About draft orders" bulb={false} defaultOpen>
  Draft orders are invisible to customers and skip stock reservation
  until they are confirmed.
</ContextHelp>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  flashMessagesEntry,
  nextStepCalloutEntry,
  contextHelpEntry,
]
