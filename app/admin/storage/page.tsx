import { requireAdmin } from '@/lib/admin/guard'
import { listStorageOrphans } from '@/lib/admin/queries'
import { StorageOrphanList } from '@/components/admin/storage-orphan-list'

export default async function AdminStoragePage() {
  await requireAdmin()
  const orphans = await listStorageOrphans()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-muted-foreground text-sm">
          Bucket <code className="text-foreground">schematics</code> · {orphans.length} orphan{orphans.length === 1 ? '' : 's'}
        </p>
      </header>

      <StorageOrphanList orphans={orphans} />
    </div>
  )
}
