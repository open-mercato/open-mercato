"use client"
import * as React from 'react'
import { MoreVertical, Pencil, Copy, Users, Trash2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '../../primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Props = {
  kind: 'personal' | 'role'
  canApplyToRoles: boolean
  deleting: boolean
  onRenameStart?: () => void
  onClone: () => void
  onShareStart?: () => void
  onDelete: () => void
}

export function ViewChipMenu({ kind, canApplyToRoles, deleting, onRenameStart, onClone, onShareStart, onDelete }: Props) {
  const t = useT()
  const showRename = kind === 'personal' && !!onRenameStart
  const showShare = kind === 'personal' && canApplyToRoles && !!onShareStart
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto px-0.5 shrink-0 hover:bg-transparent group"
          aria-label={t('ui.perspectives.chip.menu', 'View options')}
        >
          <MoreVertical className="size-3 opacity-60 group-hover:opacity-100 transition-opacity" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1.5">
        {showRename ? (
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start h-9 py-2 px-3 text-sm"
              onClick={onRenameStart}
            >
              <Pencil className="size-3 mr-2" />
              {t('ui.perspectives.menu.rename', 'Rename')}
            </Button>
          </PopoverClose>
        ) : null}
        <PopoverClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start h-9 py-2 px-3 text-sm"
            onClick={onClone}
          >
            <Copy className="size-3 mr-2" />
            {t('ui.perspectives.menu.clone', 'Clone')}
          </Button>
        </PopoverClose>
        {showShare ? (
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start h-9 py-2 px-3 text-sm"
              onClick={onShareStart}
            >
              <Users className="size-3 mr-2" />
              {t('ui.perspectives.menu.share', 'Share with roles...')}
            </Button>
          </PopoverClose>
        ) : null}
        <div className="my-1 border-t" />
        <PopoverClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start h-9 py-2 px-3 text-sm text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={deleting}
          >
            <Trash2 className="size-3 mr-2" />
            {deleting ? t('ui.perspectives.actions.removing', 'Removing…') : t('common.delete', 'Delete')}
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  )
}
