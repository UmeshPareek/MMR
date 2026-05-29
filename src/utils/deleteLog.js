import { supabase } from '../lib/supabase'

/**
 * Log a delete action to audit_log.
 * Silent-fails — never blocks the actual delete.
 *
 * @param {object} profile   - Auth profile (needs .id)
 * @param {string} tableName - DB table that was deleted from
 * @param {string} recordId  - UUID of the deleted record
 * @param {object} oldData   - Key fields of the deleted record (summary)
 */
export async function logDelete(profile, tableName, recordId, oldData = null) {
  try {
    await supabase.from('audit_log').insert({
      table_name:  tableName,
      record_id:   recordId,
      action:      'delete',
      old_data:    oldData  ? { ...oldData, _deleted_by_name: profile?.full_name, _deleted_by_role: profile?.role } : null,
      changed_by:  profile?.id ?? null,
    })
  } catch (e) {
    console.warn('[deleteLog] silent fail:', e?.message)
  }
}
