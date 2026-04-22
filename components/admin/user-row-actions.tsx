'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { promoteAdmin, demoteAdmin } from '@/app/admin/users/_actions/admins'

export type UserRowActionsProps = {
  targetUserId: string
  targetEmail: string
  isAdmin: boolean
  isSelf: boolean
  isLastAdmin: boolean
}

export function UserRowActions(props: UserRowActionsProps) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  if (!props.isAdmin) {
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>Promote</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote {props.targetEmail} to admin?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be able to moderate all content and manage other admins.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await promoteAdmin(props.targetUserId)
                  if (res.ok) {
                    toast.success(`Promoted ${props.targetEmail}`)
                    setOpen(false)
                  } else {
                    toast.error(`Promote failed: ${res.error}`)
                  }
                })
              }}
            >
              Promote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  // Admin row
  if (props.isLastAdmin) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title="Cannot demote the last remaining admin"
      >
        Demote
      </Button>
    )
  }

  const label = props.isSelf ? 'Demote (self)' : 'Demote'
  const copy = props.isSelf
    ? 'You will immediately lose admin access. /admin will 404 on your next request. Another admin will need to restore you.'
    : `Demote ${props.targetEmail}? They will immediately lose admin access.`

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={props.isSelf ? 'destructive' : 'outline'} disabled={pending}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.isSelf ? 'Demote yourself?' : `Demote ${props.targetEmail}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              start(async () => {
                const res = await demoteAdmin(props.targetUserId)
                if (res.ok) {
                  toast.success(props.isSelf ? 'You are no longer admin' : `Demoted ${props.targetEmail}`)
                  setOpen(false)
                } else {
                  toast.error(
                    res.error === 'last_admin'
                      ? 'Cannot demote the last admin'
                      : `Demote failed: ${res.error}`,
                  )
                }
              })
            }}
          >
            {props.isSelf ? 'Demote self' : 'Demote'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
