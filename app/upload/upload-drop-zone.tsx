'use client'

import { useRef, useState } from 'react'

type Format = 'litematic' | 'schem' | 'mcstructure'

type QueuedFile = {
  format: Format
  name: string
  size: number
}

function detectFormat(fileName: string): Format | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.litematic')) return 'litematic'
  if (lower.endsWith('.schem') || lower.endsWith('.schematic')) return 'schem'
  if (lower.endsWith('.mcstructure')) return 'mcstructure'
  return null
}

function setInputFiles(input: HTMLInputElement | null, file: File | null) {
  if (!input) return
  const dt = new DataTransfer()
  if (file) dt.items.add(file)
  input.files = dt.files
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function UploadDropZone() {
  const litematicRef = useRef<HTMLInputElement | null>(null)
  const schemRef = useRef<HTMLInputElement | null>(null)
  const mcstructureRef = useRef<HTMLInputElement | null>(null)
  const browseRef = useRef<HTMLInputElement | null>(null)
  const [queued, setQueued] = useState<QueuedFile[]>([])
  const [dragging, setDragging] = useState(false)

  const refFor = (format: Format) => {
    if (format === 'litematic') return litematicRef
    if (format === 'schem') return schemRef
    return mcstructureRef
  }

  const intake = (files: FileList | File[]) => {
    let next: QueuedFile[] = [...queued]
    for (const file of Array.from(files)) {
      const format = detectFormat(file.name)
      if (!format) continue
      setInputFiles(refFor(format).current, file)
      next = next.filter((q) => q.format !== format)
      next.push({ format, name: file.name, size: file.size })
    }
    setQueued(next)
  }

  const remove = (format: Format) => {
    setInputFiles(refFor(format).current, null)
    setQueued((prev) => prev.filter((q) => q.format !== format))
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length === 0) return
    intake(event.dataTransfer.files)
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!dragging) setDragging(true)
  }

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const onBrowseChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return
    intake(event.target.files)
    event.target.value = ''
  }

  return (
    <section className="border-border flex flex-col gap-4 border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs tracking-widest uppercase">Schematic files</h2>
        <span className="text-muted-foreground text-xs">Attach at least one.</span>
      </div>

      <input ref={litematicRef} type="file" name="file_litematic" accept=".litematic" className="sr-only" tabIndex={-1} />
      <input ref={schemRef} type="file" name="file_schem" accept=".schem,.schematic" className="sr-only" tabIndex={-1} />
      <input
        ref={mcstructureRef}
        type="file"
        name="file_mcstructure"
        accept=".mcstructure"
        className="sr-only"
        tabIndex={-1}
      />
      <input
        ref={browseRef}
        type="file"
        accept=".litematic,.schem,.schematic,.mcstructure"
        multiple
        onChange={onBrowseChange}
        className="sr-only"
        tabIndex={-1}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => browseRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            browseRef.current?.click()
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        data-dragging={dragging ? 'true' : undefined}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/40 hover:bg-muted/60'
        }`}
      >
        <span className="text-foreground text-sm">
          Drop .litematic / .schem / .mcstructure here
        </span>
        <span className="text-muted-foreground text-xs">(or click to browse)</span>
      </div>

      {queued.length > 0 ? (
        <ul className="border-border flex flex-col border text-sm">
          {queued.map((q) => (
            <li
              key={q.format}
              className="border-border flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-foreground text-xs">.{q.format}</span>
                <span className="text-muted-foreground text-xs truncate">
                  {q.name} · {formatBytes(q.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(q.format)}
                className="text-muted-foreground hover:text-destructive text-xs"
                aria-label={`Remove ${q.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
