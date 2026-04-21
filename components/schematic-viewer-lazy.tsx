'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const SchematicViewer = dynamic(() => import('./schematic-viewer'), {
  ssr: false,
  loading: () => (
    <div className="relative flex h-full w-full items-center justify-center">
      <Skeleton className="absolute inset-0" />
      <span className="text-muted-foreground relative text-xs tracking-widest uppercase">
        Loading viewer…
      </span>
    </div>
  ),
})

export default SchematicViewer
