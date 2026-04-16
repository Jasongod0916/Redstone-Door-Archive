import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import SchematicViewer from '@/components/schematic-viewer-lazy'
import { getDoor } from '@/lib/doors/queries'
import { doorSizeLabel } from '@/lib/types/door'

type Params = Promise<{ id: string }>

function youtubeEmbed(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      return v ? `https://www.youtube.com/embed/${v}` : null
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '')
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
  } catch {
    return null
  }
  return null
}

export default async function DoorDetailPage({ params }: { params: Params }) {
  const { id } = await params
  const door = await getDoor(id)
  if (!door) notFound()

  const schematicUrl =
    door.files.litematic ?? door.files.schem ?? door.files.mcstructure ?? null

  const embedSrc = youtubeEmbed(door.video_url)

  return (
    <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 p-6">
      <nav className="flex items-center gap-2 text-xs">
        <Link href="/" className="text-muted-foreground hover:text-foreground underline underline-offset-4">
          ← Catalog
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{doorSizeLabel(door.door_width, door.door_height)}</Badge>
          {door.minecraft_version ? <Badge variant="outline">{door.minecraft_version}</Badge> : null}
          {door.tags.map((t) => (
            <Badge key={t} variant="outline" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{door.title}</h1>
        <p className="text-muted-foreground text-sm">by {door.author}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="border-border flex min-h-[560px] flex-col border">
          {schematicUrl ? (
            <div className="relative h-[560px] w-full">
              <SchematicViewer schematicUrl={schematicUrl} schematicId={door.id} />
            </div>
          ) : (
            <div className="text-muted-foreground flex h-[560px] w-full items-center justify-center p-8 text-center text-sm">
              No schematic file attached.
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          {door.description ? (
            <p className="text-sm leading-relaxed">{door.description}</p>
          ) : null}

          <div className="border-border grid grid-cols-2 border">
            <Metric label="Non-air blocks" value={door.non_air_blocks ?? '—'} />
            <Metric label="Bounding box" value={`${door.bbox_w ?? '—'} × ${door.bbox_h ?? '—'} × ${door.bbox_d ?? '—'}`} />
            <Metric label="Open ticks" value={door.open_ticks ?? '—'} />
            <Metric label="Close ticks" value={door.close_ticks ?? '—'} />
            <Metric label="Total ticks" value={door.total_ticks ?? '—'} span={2} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs tracking-widest uppercase">Files</p>
            <div className="flex flex-wrap gap-2">
              {(['litematic', 'schem', 'mcstructure'] as const).map((key) => {
                const url = door.files[key]
                if (!url) return null
                return (
                  <Button key={key} asChild variant="outline" size="sm">
                    <a href={url} download>
                      .{key}
                    </a>
                  </Button>
                )
              })}
              {Object.values(door.files).every((v) => !v) ? (
                <span className="text-muted-foreground text-xs">No downloads available.</span>
              ) : null}
            </div>
          </div>

          {embedSrc ? (
            <div className="aspect-video w-full overflow-hidden border border-border">
              <iframe
                src={embedSrc}
                title={`${door.title} video`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          ) : door.video_url ? (
            <a href={door.video_url} className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer">
              Watch video →
            </a>
          ) : null}
        </aside>
      </div>
    </main>
  )
}

function Metric({ label, value, span = 1 }: { label: string; value: React.ReactNode; span?: 1 | 2 }) {
  return (
    <div
      className={`border-border flex flex-col gap-1 border-b border-r p-3 last:border-r-0 ${
        span === 2 ? 'col-span-2 border-r-0' : ''
      }`}
    >
      <span className="text-muted-foreground text-xs tracking-widest uppercase">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
