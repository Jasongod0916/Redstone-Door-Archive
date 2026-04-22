'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { softDeleteDoor } from '@/app/admin/_actions/doors'

export function DoorRowActions({ doorId, deleted }: { doorId: string; deleted: boolean }) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  if (deleted) {
    // Deleted rows show restore/hard-delete on the Trash page, not here.
    return <span className="text-xs text-muted-foreground">see Trash</span>
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/doors/${doorId}/edit`}>Edit</Link>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Soft-delete this door?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be hidden from the public catalog. You can restore it from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await softDeleteDoor(doorId)
                  if (res.ok) {
                    toast.success('Door moved to Trash')
                    setOpen(false)
                  } else {
                    toast.error(`Delete failed: ${res.error}`)
                  }
                })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
