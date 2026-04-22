'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { restoreDoor, hardDeleteDoor } from '@/app/admin/_actions/doors'

export function TrashRowActions({ doorId }: { doorId: string }) {
  const [pending, start] = useTransition()
  const [hardOpen, setHardOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const res = await restoreDoor(doorId)
            if (res.ok) toast.success('Restored')
            else toast.error(`Restore failed: ${res.error}`)
          })
        }}
      >
        Restore
      </Button>
      <AlertDialog open={hardOpen} onOpenChange={setHardOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            Delete permanently
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this door?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the schematic, thumbnail, and video files from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await hardDeleteDoor(doorId)
                  if (res.ok) {
                    toast.success('Permanently deleted')
                    setHardOpen(false)
                  } else {
                    toast.error(`Delete failed: ${res.error}`)
                  }
                })
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
