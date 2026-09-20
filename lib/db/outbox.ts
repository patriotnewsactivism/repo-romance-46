/**
 * Transactional Outbox pattern for reliable event dispatch after DB commit.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface OutboxEntry {
  id?: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'published' | 'failed';
  created_at?: string;
  published_at?: string;
}

export async function insertOutboxEntry(entry: Omit<OutboxEntry, 'id' | 'status' | 'created_at'>): Promise<string> {
  const { data, error } = await supabase
    .from('outbox')
    .insert({
      ...entry,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function fetchPendingOutbox(limit = 50): Promise<OutboxEntry[]> {
  const { data, error } = await supabase
    .from('outbox')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function markPublished(id: string): Promise<void> {
  const { error } = await supabase
    .from('outbox')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markFailed(id: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from('outbox')
    .update({ status: 'failed', payload: { ...(reason ? { failure_reason: reason } : {}) } })
    .eq('id', id);
  if (error) throw error;
}
