import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import SchematicViewer from '@/components/schematic-viewer-lazy'
import { getPreferredDoorFile } from '@/lib/doors/files'
import { normalizeMinecraftVersion } from '@/lib/minecraft-version'
import type { DoorCardRow } from '@/lib/doors/queries'

export function DoorCard({
  door,
  footer,
}: {
  door: DoorCardRow
  footer?: ReactNode
}) {
  const preferredFile = getPreferredDoorFile(door)
  const minecraftVersion = normalizeMinecraftVersion(door.minecraft_version)

  return (
    <article className="panel-surface group relative flex flex-col overflow-hidden border border-border transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_24px_50px_-34px_rgba(67,34,21,0.55)]">
      <div className="h-0.5 w-full bg-primary opacity-60 transition-opacity group-hover:opacity-100" />

      {preferredFile ? (
        <Link
          href={`/view/${door.id}`}
          className="bg-muted relative block aspect-video w-full overflow-hidden border-b border-border"
        >
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/40 via-black/8 to-transparent opacity-90" />
          <div className="absolute left-3 top-3 z-20 border border-white/18 bg-black/55 px-2 py-1 text-[10px] tracking-[0.22em] uppercase text-white/78 backdrop-blur-sm">
            3D Preview
          </div>
          <SchematicViewer
            schematicUrl={preferredFile.url}
            schematicId={`card-${door.id}`}
            className="h-full w-full"
            emptyLabel="Preview unavailable."
            showQualityToggle={false}
          />
        </Link>
      ) : door.thumbnail_url ? (
        <Link
          href={`/view/${door.id}`}
          className="bg-muted relative block aspect-video w-full overflow-hidden border-b border-border"
        >
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/28 via-transparent to-transparent opacity-80" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={door.thumbnail_url}
            alt={`${door.title} preview`}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-hover:opacity-95"
          />
        </Link>
      ) : null}

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="border-primary/30 bg-primary/10 text-primary text-xs">
            {door.door_size}
          </Badge>
          {minecraftVersion ? (
            <Badge variant="outline" className="text-xs">
              {minecraftVersion}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-col gap-0.5">
          <Link
            href={`/view/${door.id}`}
            className="font-semibold leading-tight transition-colors hover:text-primary"
          >
            {door.title}
          </Link>
          <span className="text-muted-foreground text-xs">by {door.author}</span>
        </div>

        {door.description ? (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
            {door.description}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 border border-border bg-background/70 p-2">
          <Stat label="Blocks" value={door.block_count ?? '—'} />
          <Stat label="Open" value={door.open_ticks != null ? `${door.open_ticks}t` : '—'} />
          <Stat label="Total" value={door.total_ticks != null ? `${door.total_ticks}t` : '—'} />
        </div>

        {door.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {door.tags.slice(0, 5).map((t) => (
              <span key={t} className="border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        <div className="pt-1">
          {footer ?? (
            <Button asChild size="sm" className="w-full glow-red">
              <Link href={`/view/${door.id}`}>View 3D →</Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs tracking-widest uppercase">{label}</span>
      <span className="text-foreground text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}
