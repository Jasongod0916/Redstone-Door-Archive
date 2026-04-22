'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { updateDoorMeta } from '@/app/admin/_actions/doors'
import type { AdminDoorRow } from '@/lib/admin/queries'

export function DoorEditForm({ door }: { door: AdminDoorRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [form, setForm] = useState(() => ({
    title: door.title ?? '',
    author: door.author ?? '',
    description: door.description ?? '',
    tags: (door.tags ?? []).join(', '),
    minecraft_version: door.minecraft_version ?? '',
    door_size: door.door_size ?? '',
    block_count: door.block_count ?? '',
    open_ticks: door.open_ticks ?? '',
    close_ticks: door.close_ticks ?? '',
    total_ticks: door.total_ticks ?? '',
    bounds_width: door.bounds_width ?? '',
    bounds_height: door.bounds_height ?? '',
    bounds_depth: door.bounds_depth ?? '',
    video_url: door.video_url ?? '',
  }))

  function bind<K extends keyof typeof form>(key: K) {
    return {
      value: String(form[key] ?? ''),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((s) => ({ ...s, [key]: e.target.value })),
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await updateDoorMeta(door.id, {
        title: form.title,
        author: form.author,
        description: form.description,
        tags: form.tags,
        minecraft_version: form.minecraft_version,
        door_size: form.door_size,
        block_count: form.block_count === '' ? null : Number(form.block_count),
        open_ticks: form.open_ticks === '' ? null : Number(form.open_ticks),
        close_ticks: form.close_ticks === '' ? null : Number(form.close_ticks),
        total_ticks: form.total_ticks === '' ? null : Number(form.total_ticks),
        bounds_width: form.bounds_width === '' ? null : Number(form.bounds_width),
        bounds_height: form.bounds_height === '' ? null : Number(form.bounds_height),
        bounds_depth: form.bounds_depth === '' ? null : Number(form.bounds_depth),
        video_url: form.video_url,
      })
      if (res.ok) {
        toast.success('Saved')
        router.push('/admin/doors')
      } else {
        toast.error(`Save failed: ${res.error}`)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Title"><Input {...bind('title')} required /></Field>
      <Field label="Author"><Input {...bind('author')} /></Field>
      <Field label="Size (e.g. 3x3)"><Input {...bind('door_size')} /></Field>
      <Field label="Minecraft version"><Input {...bind('minecraft_version')} /></Field>
      <Field label="Tags (comma separated)" className="md:col-span-2"><Input {...bind('tags')} /></Field>
      <Field label="Description" className="md:col-span-2"><Textarea rows={4} {...bind('description')} /></Field>
      <Field label="Block count"><Input type="number" {...bind('block_count')} /></Field>
      <Field label="Open ticks"><Input type="number" {...bind('open_ticks')} /></Field>
      <Field label="Close ticks"><Input type="number" {...bind('close_ticks')} /></Field>
      <Field label="Total ticks"><Input type="number" {...bind('total_ticks')} /></Field>
      <Field label="Bounds W"><Input type="number" {...bind('bounds_width')} /></Field>
      <Field label="Bounds H"><Input type="number" {...bind('bounds_height')} /></Field>
      <Field label="Bounds D"><Input type="number" {...bind('bounds_depth')} /></Field>
      <Field label="Video URL" className="md:col-span-2"><Input {...bind('video_url')} /></Field>

      <div className="md:col-span-2 flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
      </div>
    </form>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-xs tracking-widest uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
