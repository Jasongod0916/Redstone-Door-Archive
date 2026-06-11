import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/server'
import { createDoorAction } from './actions'
import UploadDropZone from './upload-drop-zone'

export default async function UploadPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/auth/login?next=/upload')

  const defaultAuthor = data.user.email?.split('@')[0] ?? ''

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <nav className="flex items-center gap-2 text-xs">
        <Link href="/" className="text-muted-foreground hover:text-foreground underline underline-offset-4">
          ← Catalog
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs tracking-widest uppercase">Upload</p>
        <h1 className="text-3xl font-semibold tracking-tight">Submit a redstone door</h1>
        <p className="text-muted-foreground text-sm">
          Attach at least one schematic file. All fields except file(s), title, and size are optional.
        </p>
      </header>

      <form action={createDoorAction} className="flex flex-col gap-6">
        <Section title="Basics">
          <Field label="Title" name="title" required />
        </Section>

        <UploadDropZone />

        <Section title="Door size">
          <div className="col-span-2 flex items-end gap-2">
            <div className="flex w-24 flex-col gap-2">
              <Label htmlFor="door_width">Width</Label>
              <Input id="door_width" name="door_width" type="number" min={1} required />
            </div>
            <span className="pb-2 text-lg">×</span>
            <div className="flex w-24 flex-col gap-2">
              <Label htmlFor="door_height">Height</Label>
              <Input id="door_height" name="door_height" type="number" min={1} required />
            </div>
            <p className="text-muted-foreground pb-2 text-xs">
              Any positive width × height is allowed. The catalog&apos;s size filters are generated from submitted sizes automatically.
            </p>
          </div>
        </Section>

        <details className="border-border flex flex-col gap-4 border p-4">
          <summary className="text-xs tracking-widest uppercase cursor-pointer">Advanced (optional)</summary>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Author" name="author" defaultValue={defaultAuthor} />
            <Field label="Minecraft version" name="minecraft_version" placeholder="1.20.4" />
            <div className="col-span-2 flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
            <Field label="Block count" name="block_count" type="number" min={0} />
            <div className="col-span-2 grid grid-cols-3 gap-3">
              <Field label="Bounding W" name="bounds_width" type="number" min={0} />
              <Field label="Bounding H" name="bounds_height" type="number" min={0} />
              <Field label="Bounding D" name="bounds_depth" type="number" min={0} />
            </div>
            <Field label="Open ticks" name="open_ticks" type="number" min={0} />
            <Field label="Close ticks" name="close_ticks" type="number" min={0} />
            <Field label="YouTube / video URL" name="video_url" />
            <Field label="Tags (comma-separated)" name="tags" placeholder="flush, piston, seamless" />
          </div>
        </details>

        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/">Cancel</Link>
          </Button>
          <Button type="submit">Publish</Button>
        </div>
      </form>
    </main>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border flex flex-col gap-4 border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs tracking-widest uppercase">{title}</h2>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  min,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  placeholder?: string
  min?: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
      />
    </div>
  )
}

