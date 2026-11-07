'use client'

import * as React from 'react'
import { LayoutGrid, ChevronDown } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownInput,
  DropdownList,
  DropdownGroup,
  DropdownItem,
  DropdownEmpty,
} from '@open-mercato/ui/primitives/dropdown'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ScreenLink = { id: string; title: string; area: string }
const primaryScreens = ['s1', 's2', 's7', 's11', 's15', 's38']

export function FinanceNavigation({
  screens,
  active,
  goTo,
}: {
  screens: ScreenLink[]
  active: ScreenLink
  goTo: (id: string) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const areas = Array.from(new Set(screens.map((screen) => screen.area)))
  const primary = primaryScreens.flatMap(
    (id) => screens.find((screen) => screen.id === id) ?? [],
  )
  const isOtherArea = !primary.some((screen) => screen.area === active.area)

  return (
    <nav
      aria-label={t('finance_previews.nav.group')}
      className="flex items-center gap-2 border-b border-border pb-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {primary.map((screen) => (
          <Button
            key={screen.id}
            asChild
            variant="ghost"
            size="sm"
            className={
              active.area === screen.area
                ? 'shrink-0 bg-muted text-foreground'
                : 'shrink-0 text-muted-foreground'
            }
          >
            <a
              href={`#${screen.id}`}
              aria-current={active.area === screen.area ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                goTo(screen.id)
              }}
            >
              {screen.area}
            </a>
          </Button>
        ))}
      </div>
      <Dropdown open={open} onOpenChange={setOpen}>
        <DropdownTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label={t('finance_previews.nav.browse')}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">
              {isOtherArea ? active.area : t('finance_previews.nav.browse')}
            </span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-80 max-w-full">
          <DropdownInput
            placeholder={t('finance_previews.nav.find')}
            aria-label={t('finance_previews.nav.find')}
          />
          <DropdownList className="max-h-96">
            <DropdownEmpty>{t('finance_previews.screen.empty')}</DropdownEmpty>
            {areas.map((area) => (
              <DropdownGroup key={area} heading={area}>
                {screens
                  .filter((screen) => screen.area === area)
                  .map((screen) => (
                    <DropdownItem
                      key={screen.id}
                      value={`${area} ${screen.title}`}
                      checked={screen.id === active.id}
                      onSelect={() => {
                        setOpen(false)
                        goTo(screen.id)
                      }}
                    >
                      {screen.title}
                    </DropdownItem>
                  ))}
              </DropdownGroup>
            ))}
          </DropdownList>
        </DropdownContent>
      </Dropdown>
    </nav>
  )
}
