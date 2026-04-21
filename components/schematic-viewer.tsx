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

// Three.js dropped the UMD build after r0.159, so we load the current ES
// module build dynamically and assign the namespace to window.THREE. The
// schematic-renderer UMD (which marks `three` as external) reads it from
// there.
const THREE_SRC = process.env.NEXT_PUBLIC_THREE_URL ?? '/vendor/three.module.min.js'

const RENDERER_SRC =
  process.env.NEXT_PUBLIC_SCHEMATIC_RENDERER_URL ?? '/vendor/schematic-renderer.umd.js'

let threeLoadPromise: Promise<void> | null = null

function ensureThreeLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.THREE) return Promise.resolve()
  if (!threeLoadPromise) {
    threeLoadPromise = import(/* webpackIgnore: true */ /* @vite-ignore */ THREE_SRC)
      .then((mod: unknown) => {
        window.THREE = (mod as { default?: unknown }).default ?? mod
      })
      .catch((err) => {
        threeLoadPromise = null
        throw err
      })
  }
  return threeLoadPromise
}

type SchematicViewerProps = {
  schematicUrl: string
  schematicId?: string
  className?: string
  emptyLabel?: string
}

type Quality = 'performance' | 'quality'
const QUALITY_STORAGE_KEY = 'schematic-viewer-quality'
const DPR_BY_QUALITY: Record<Quality, number> = { performance: 1, quality: 2 }

function readStoredQuality(): Quality {
  if (typeof window === 'undefined') return 'performance'
  const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY)
  return stored === 'quality' ? 'quality' : 'performance'
}

function ThreeLoader({
  onReady,
  onFail,
}: {
  onReady: () => void
  onFail: (message: string) => void
}) {
  useEffect(() => {
    let cancelled = false
    ensureThreeLoaded()
      .then(() => {
        if (!cancelled) onReady()
      })
      .catch((err) => {
        if (cancelled) return
        onFail(err instanceof Error ? err.message : 'Failed to load Three.js.')
      })
    return () => {
      cancelled = true
    }
  }, [onReady, onFail])
  return null
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
  const [quality, setQuality] = useState<Quality>('performance')

  useEffect(() => {
    queueMicrotask(() => setQuality(readStoredQuality()))
  }, [])

  const toggleQuality = () => {
    setQuality((prev) => {
      const next = prev === 'performance' ? 'quality' : 'performance'
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, next)
      }
      return next
    })
  }

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
        const cap = DPR_BY_QUALITY[quality]
        const ratio = Math.min(
          typeof window !== 'undefined' ? window.devicePixelRatio : 1,
          cap,
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
  }, [inView, threeReady, rendererReady, schematicId, schematicUrl, quality])

  return (
    <div className={className} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggleQuality}
        aria-label="Toggle render quality"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.6)',
          color: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(255,255,255,0.2)',
          cursor: 'pointer',
        }}
      >
        {quality === 'performance' ? 'Perf' : 'Quality'}
      </button>
      {inView ? (
        <>
          <ThreeLoader onReady={() => setThreeReady(true)} onFail={setError} />
          {threeReady ? (
            <Script
              src={RENDERER_SRC}
              strategy="afterInteractive"
              onLoad={() => setRendererReady(true)}
              onError={() => setError('Failed to load schematic-renderer.')}
            />
          ) : null}
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
