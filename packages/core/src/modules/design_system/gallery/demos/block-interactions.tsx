'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KeyValue, keyValueFixtures, type KeyValueItem } from '@open-mercato/ui/blocks/key-value'
import { Wizard } from '@open-mercato/ui/blocks/wizard'
import { wizardFixtures } from '@open-mercato/ui/blocks/wizard/fixtures'
import { Button } from '@open-mercato/ui/primitives/button'

export function EditableKeyValueExample() {
  const [items, setItems] = React.useState<KeyValueItem[]>(keyValueFixtures.editable.items)
  return (
    <KeyValue
      {...keyValueFixtures.editable}
      items={items}
      onEdit={async (key, value) => {
        setItems((current) => current.map((item) => item.key === key ? { ...item, value } : item))
      }}
    />
  )
}

const pages = [wizardFixtures.firstStep, wizardFixtures.middleStep, wizardFixtures.lastStep]

type WizardStart = 'firstStep' | 'middleStep' | 'lastStep' | 'selectable'

export function WizardNavigationExample({ initial }: { initial: WizardStart }) {
  const t = useT()
  const [activeStepId, setActiveStepId] = React.useState<string>(wizardFixtures[initial].activeStepId)
  const [finished, setFinished] = React.useState(false)
  const activeIndex = pages.findIndex((page) => page.activeStepId === activeStepId)
  const page = pages[activeIndex]

  if (finished) {
    return (
      <div className="space-y-3">
        <p role="status">{t('design_system.gallery.wizard.finished')}</p>
        <Button onClick={() => {
          setActiveStepId(pages[0].activeStepId)
          setFinished(false)
        }}>{t('design_system.gallery.wizard.restart')}</Button>
      </div>
    )
  }

  return (
    <Wizard
      {...page}
      onNext={async () => {
        setActiveStepId(pages[activeIndex + 1].activeStepId)
        return true
      }}
      onBack={() => setActiveStepId(pages[activeIndex - 1].activeStepId)}
      onStepSelect={initial === 'selectable' ? setActiveStepId : undefined}
      onFinish={async () => setFinished(true)}
    >
      {pages.map((step) => (
        <div key={step.activeStepId} hidden={step.activeStepId !== activeStepId}>{step.children}</div>
      ))}
    </Wizard>
  )
}
