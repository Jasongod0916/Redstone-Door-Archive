import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/guard'
import { AdminNav } from '@/components/admin/admin-nav'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdmin()

  return (
    <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[220px_1fr] gap-6 p-6">
      <aside className="border border-border bg-card h-fit sticky top-6">
        <div className="border-b border-border p-4">
          <Link href="/" className="text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground">
            ← Back to site
          </Link>
          <div className="mt-2 text-sm text-foreground truncate">{actor.email}</div>
        </div>
        <AdminNav />
      </aside>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  )
}
