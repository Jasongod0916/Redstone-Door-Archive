'use client'

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

type SchematicRendererCtor = new (
  canvas: HTMLCanvasElement,
  schematics: Record<string, () => Promise<ArrayBuffer>>,
  resourcePacks: Record<string, () => Promise<Blob>>,
  options: Record<string, unknown>,
) => { dispose?: () => void }

declare global {
  interface Window {
    THREE?: unknown
    SchematicRenderer?: { SchematicRenderer: SchematicRendererCtor }
  }
}

const THREE_SRC =
  process.env.NEXT_PUBLIC_THREE_URL ??
  'https://unpkg.com/three@0.181.2/build/three.min.js'

const RENDERER_SRC =
  process.env.NEXT_PUBLIC_SCHEMATIC_RENDERER_URL ??
  'https://unpkg.com/schematic-renderer@1.1.24/dist/schematic-renderer.umd.js'

type SchematicViewerProps = {
  /** Public URL of a .litematic / .schem / .mcstructure file. */
  schematicUrl: string
  /** Stable identifier used as the schematic key the renderer keeps internally. */
  schematicId?: string
  className?: string
  /** Optional label shown when the file cannot be loaded. */
  emptyLabel?: string
}

export default function SchematicViewer({
  schematicUrl,
  schematicId = 'door',
  className,
  emptyLabel = 'Unable to load schematic.',
}: SchematicViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<{ dispose?: () => void } | null>(null)
  const [threeReady, setThreeReady] = useState(false)
  const [rendererReady, setRendererReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!threeReady || !rendererReady) return
    if (!canvasRef.current) return

    const Ctor = window.SchematicRenderer?.SchematicRenderer
    if (!Ctor) {
      console.error('SchematicRenderer global missing after load.')
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const instance = new Ctor(
          canvasRef.current!,
          {
            [schematicId]: async () => {
              const res = await fetch(schematicUrl)
              if (!res.ok) throw new Error(`Fetch ${schematicUrl}: ${res.status}`)
              return res.arrayBuffer()
            },
          },
          {},
          {
            backgroundColor: 0x8fa8cf,
            showGrid: true,
            enableDragAndDrop: false,
            enableProgressBar: false,
            cameraOptions: { position: [18, 18, 18], useTightBounds: true },
          },
        )
        if (cancelled) {
          instance.dispose?.()
        } else {
          rendererRef.current = instance
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      cancelled = true
      rendererRef.current?.dispose?.()
      rendererRef.current = null
    }
  }, [threeReady, rendererReady, schematicId, schematicUrl])

  return (
    <div className={className}>
      <Script
        src={THREE_SRC}
        strategy="afterInteractive"
        onLoad={() => setThreeReady(true)}
        onError={() => setError('Failed to load Three.js.')}
      />
      <Script
        src={RENDERER_SRC}
        strategy="afterInteractive"
        onLoad={() => setRendererReady(true)}
        onError={() => setError('Failed to load schematic-renderer.')}
      />
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {error ? (
        <p role="alert" style={{ padding: 12, fontSize: 13 }}>
          {emptyLabel} <span style={{ opacity: 0.7 }}>({error})</span>
        </p>
      ) : null}
    </div>
  )
}
