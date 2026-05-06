import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import SchematicViewer from '@/components/schematic-viewer-lazy'
import { getDoor } from '@/lib/doors/queries'
import { normalizeMinecraftVersion } from '@/lib/minecraft-version'
import type { DoorFileFormat, DoorWithFiles } from '@/lib/types/door'

type Params = Promise<{ id: string }>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const THREE_SRC = process.env.NEXT_PUBLIC_THREE_URL ?? '/vendor/three.module.min.js'
const RENDERER_SRC =
  process.env.NEXT_PUBLIC_SCHEMATIC_RENDERER_URL ?? '/vendor/schematic-renderer.umd.js'

const FORMAT_PREFERENCE: DoorFileFormat[] = ['litematic', 'schem', 'mcstructure', 'schematic', 'nbt']

function schematicPublicUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/schematics/${storagePath}`
}

type ResolvedFile = {
  id: string
  format: DoorFileFormat
  url: string
  file_name: string
}

function resolveFiles(door: DoorWithFiles): ResolvedFile[] {
  return door.door_files.map((f) => ({
    id: f.id,
    format: f.format,
    url: schematicPublicUrl(f.storage_path),
    file_name: f.file_name,
  }))
}

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

  const files = resolveFiles(door)
  const preferredFile =
    FORMAT_PREFERENCE.map((fmt) => files.find((f) => f.format === fmt)).find(Boolean) ??
    files[0] ??
    null

  const schematicUrl = preferredFile?.url ?? null
  const embedSrc = youtubeEmbed(door.video_url)
  const minecraftVersion = normalizeMinecraftVersion(door.minecraft_version)

  return (
    <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 p-6">
      {/* Preload the 3D viewer bundles so they're in-flight before IntersectionObserver fires. */}
      <link rel="modulepreload" href={THREE_SRC} />
      <link rel="preload" as="script" href={RENDERER_SRC} />
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs pt-2">
        <Link
          href="/"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          ← Catalog
        </Link>
        <span className="text-border">/</span>
        <span className="text-foreground truncate max-w-xs">{door.title}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 bg-primary glow-red" />
          <span className="text-primary text-xs tracking-widest uppercase">{door.door_size} door</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight leading-tight">{door.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">by {door.author}</span>
          {minecraftVersion ? (
            <Badge variant="outline" className="text-xs">{minecraftVersion}</Badge>
          ) : null}
          {door.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-xs font-normal">{t}</Badge>
          ))}
        </div>
      </header>

      {/* Main content */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 3D Viewer */}
        <section className="border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-2 flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-primary glow-red" />
            <span className="text-xs tracking-widest uppercase text-muted-foreground">3D Preview</span>
          </div>
          {schematicUrl ? (
            <div className="h-[520px] w-full">
              <SchematicViewer
                schematicUrl={schematicUrl}
                schematicId={door.id}
                className="h-full w-full"
              />
            </div>
          ) : (
            <div className="text-muted-foreground flex h-[520px] w-full items-center justify-center text-sm">
              No schematic file attached.
            </div>
          )}
        </section>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4">
          {door.description ? (
            <div className="border border-border bg-card p-4">
              <p className="text-muted-foreground text-xs tracking-widest uppercase mb-2">About</p>
              <p className="text-sm leading-relaxed">{door.description}</p>
            </div>
          ) : null}

          {/* Stats */}
          <div className="border border-border bg-card">
            <div className="border-b border-border px-4 py-2">
              <span className="text-xs tracking-widest uppercase text-muted-foreground">Stats</span>
            </div>
            <div className="grid grid-cols-2">
              <Metric label="Blocks" value={door.block_count ?? '—'} />
              <Metric
                label="Bounds"
                value={
                  door.bounds_width
                    ? `${door.bounds_width}×${door.bounds_height}×${door.bounds_depth}`
                    : '—'
                }
              />
              <Metric label="Open" value={door.open_ticks != null ? `${door.open_ticks}t` : '—'} />
              <Metric label="Close" value={door.close_ticks != null ? `${door.close_ticks}t` : '—'} />
              <Metric
                label="Total"
                value={door.total_ticks != null ? `${door.total_ticks}t` : '—'}
                span={2}
                highlight
              />
            </div>
          </div>

          {/* Downloads */}
          <div className="border border-border bg-card p-4 flex flex-col gap-3">
            <p className="text-muted-foreground text-xs tracking-widest uppercase">Downloads</p>
            {files.length === 0 ? (
              <p className="text-muted-foreground text-xs">No files available.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <Button key={f.id} asChild variant="outline" size="sm">
                    <a href={f.url} download={f.file_name}>
                      .{f.format}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Video */}
          {embedSrc ? (
            <div className="border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-4 py-2">
                <span className="text-xs tracking-widest uppercase text-muted-foreground">Video</span>
              </div>
              <div className="aspect-video w-full">
                <iframe
                  src={embedSrc}
                  title={`${door.title} video`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </div>
          ) : door.video_url ? (
            <a
              href={door.video_url}
              className="text-sm text-primary underline underline-offset-4 hover:opacity-80 transition-opacity"
              target="_blank"
              rel="noreferrer"
            >
              Watch video →
            </a>
          ) : null}
        </aside>
      </div>
    </main>
  )
}

function Metric({
  label,
  value,
  span = 1,
  highlight,
}: {
  label: string
  value: React.ReactNode
  span?: 1 | 2
  highlight?: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-1 border-b border-r border-border p-3 last:border-r-0 ${
        span === 2 ? 'col-span-2 border-r-0' : ''
      } ${highlight ? 'bg-primary/5' : ''}`}
    >
      <span className="text-muted-foreground text-xs tracking-widest uppercase">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-primary' : ''}`}>
        {value}
      </span>
    </div>
  )
}
