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

const THREE_SRC = process.env.NEXT_PUBLIC_THREE_URL ?? '/vendor/three.min.js'

const RENDERER_SRC =
  process.env.NEXT_PUBLIC_SCHEMATIC_RENDERER_URL ?? '/vendor/schematic-renderer.umd.js'

type SchematicViewerProps = {
  schematicUrl: string
  schematicId?: string
  className?: string
  emptyLabel?: string
}

function applyPixelRatioCap(instance: unknown, ratio: number) {
  if (!instance || typeof instance !== 'object') return
  const candidates = ['renderer', 'core', 'threeJsRenderer'] as const
  const record = instance as Record<string, unknown>
  for (const key of candidates) {
    const node = record[key]
    if (!node || typeof node !== 'object') continue
    const setPR = (node as Record<string, unknown>).setPixelRatio
    if (typeof setPR === 'function') {
      try {
        ;(setPR as (r: number) => void).call(node, ratio)
        return
      } catch {
        // best-effort; try next shape
      }
    }
    const innerRenderer = (node as Record<string, unknown>).renderer
    if (innerRenderer && typeof innerRenderer === 'object') {
      const innerSetPR = (innerRenderer as Record<string, unknown>).setPixelRatio
      if (typeof innerSetPR === 'function') {
        try {
          ;(innerSetPR as (r: number) => void).call(innerRenderer, ratio)
          return
        } catch {
          // fall through
        }
      }
    }
  }
}

export default function SchematicViewer({
  schematicUrl,
  schematicId = 'door',
  className,
  emptyLabel = 'Unable to load schematic.',
}: SchematicViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<{ dispose?: () => void } | null>(null)
  const [inView, setInView] = useState(false)
  const [threeReady, setThreeReady] = useState(false)
  const [rendererReady, setRendererReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setInView(true))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '256px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || !threeReady || !rendererReady) return
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
            backgroundColor: 0x111111,
            showGrid: false,
            enableDragAndDrop: false,
            enableProgressBar: false,
            cameraOptions: { position: [18, 18, 18], useTightBounds: true },
          },
        )
        if (cancelled) {
          instance.dispose?.()
          return
        }
        rendererRef.current = instance
        const ratio = Math.min(
          typeof window !== 'undefined' ? window.devicePixelRatio : 1,
          1.5,
        )
        applyPixelRatioCap(instance, ratio)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      cancelled = true
      rendererRef.current?.dispose?.()
      rendererRef.current = null
    }
  }, [inView, threeReady, rendererReady, schematicId, schematicUrl])

  return (
    <div className={className}>
      {inView ? (
        <>
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
        </>
      ) : null}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {error ? (
        <p role="alert" style={{ padding: 12, fontSize: 13 }}>
          {emptyLabel} <span style={{ opacity: 0.7 }}>({error})</span>
        </p>
      ) : null}
    </div>
  )
}
