import { createClient } from '@/lib/supabase/server'
import type { AdminUser } from './guard'

export type AuditAction =
  | 'door.update'
  | 'door.soft_delete'
  | 'door.restore'
  | 'door.hard_delete'
  | 'door.hard_delete_failed'
  | 'admin.promote'
  | 'admin.demote'
  | 'door.feature'
  | 'door.unfeature'
  | 'door.reorder'

export type AuditTargetType = 'door' | 'user'

export type LogAdminActionInput = {
  actor: AdminUser
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  details?: Record<string, unknown>
}

export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('admin_audit_log').insert({
    actor_id: input.actor.id,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    details: input.details ?? {},
  })
  if (error) {
    console.warn('[admin/audit] insert failed:', error.message, {
      action: input.action,
      targetId: input.targetId,
    })
  }
}
