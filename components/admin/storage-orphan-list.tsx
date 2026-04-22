'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { formatBytes } from '@/lib/admin/format'
import { cleanupOrphans } from '@/app/admin/storage/_actions/orphans'
import type { StorageOrphan } from '@/lib/admin/queries'

export function StorageOrphanList({ orphans }: { orphans: StorageOrphan[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [open, setOpen] = useState(false)

  if (orphans.length === 0) {
    return (
      <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No orphan files. Storage is clean.
      </div>
    )
  }

  const allSelected = selected.size === orphans.length && orphans.length > 0
  const count = selected.size

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(orphans.map((o) => o.name)))
  }
  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function onConfirmDelete() {
    start(async () => {
      const res = await cleanupOrphans([...selected])
      if (res.ok) {
        toast.success(`Deleted ${res.count} orphan ${res.count === 1 ? 'file' : 'files'}`)
        setSelected(new Set())
        setOpen(false)
        router.refresh()
      } else {
        toast.error(
          res.error === 'too_many'
            ? 'Too many files selected (max 100 at a time)'
            : `Delete failed: ${res.error}`,
        )
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <label className="flex items-center gap-2 text-xs tracking-widest uppercase text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all orphan files"
          />
          Select all
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {count} selected / {orphans.length} total
        </span>
      </header>

      <ul className="divide-y divide-border">
        {orphans.map((o) => (
          <li key={o.name} className="flex items-center gap-3 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={selected.has(o.name)}
              onChange={() => toggleOne(o.name)}
              aria-label={`Select ${o.name}`}
            />
            <code className="flex-1 truncate text-foreground">{o.name}</code>
            <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(o.size)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {new Date(o.created_at).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending || count === 0}
            >
              Delete {count} selected
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete {count} orphan files?</AlertDialogTitle>
              <AlertDialogDescription>
                The files will be removed from storage. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirmDelete}>
                Delete {count}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </footer>
    </div>
  )
}
