'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  featureDoor,
  unfeatureDoor,
  moveFeaturedUp,
  moveFeaturedDown,
} from '@/app/admin/curation/_actions/featured'

export type FeaturedRowActionsProps = {
  doorId: string
  title: string
  isFirst: boolean
  isLast: boolean
}

export function FeaturedRowActions(props: FeaturedRowActionsProps) {
  const [pending, start] = useTransition()
  const [removeOpen, setRemoveOpen] = useState(false)

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = (await action()) as { ok: true } | { ok: false; error: string }
      if (res.ok) return
      toast.error(`Failed: ${res.error}`)
    })
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || props.isFirst}
        onClick={() => run(() => moveFeaturedUp(props.doorId))}
        title={props.isFirst ? 'Already first' : 'Move up'}
        aria-label="Move up"
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || props.isLast}
        onClick={() => run(() => moveFeaturedDown(props.doorId))}
        title={props.isLast ? 'Already last' : 'Move down'}
        aria-label="Move down"
      >
        ↓
      </Button>
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            Remove
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {props.title} from featured?</AlertDialogTitle>
            <AlertDialogDescription>
              It will return to the regular catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await unfeatureDoor(props.doorId)
                  if (res.ok) {
                    toast.success(`Removed ${props.title} from featured`)
                    setRemoveOpen(false)
                  } else {
                    toast.error(`Remove failed: ${res.error}`)
                  }
                })
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function AddButton({ doorId, title }: { doorId: string; title: string }) {
  const [pending, start] = useTransition()

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const res = await featureDoor(doorId)
          if (res.ok) toast.success(`Added ${title} to featured`)
          else toast.error(`Add failed: ${res.error}`)
        })
      }}
    >
      Add
    </Button>
  )
}
