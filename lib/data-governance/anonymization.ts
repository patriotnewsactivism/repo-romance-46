/**
 * Anonymization Service for learning data privacy compliance.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function anonymizeLearningRecord(recordId: string): Promise<void> {
  const { error } = await supabase
    .from('operational_memory')
    .update({
      user_id: null,
      repo_full_name: '[anonymized]',
      anonymized: true,
      anonymized_at: new Date().toISOString(),
    })
    .eq('id', recordId);

  if (error) throw error;
}

export async function runRetentionPolicy(retentionDays = 365): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { data, error } = await supabase
    .from('operational_memory')
    .update({ anonymized: true, user_id: null })
    .lt('created_at', cutoff.toISOString())
    .eq('anonymized', false)
    .select('id');

  if (error) throw error;
  return data?.length || 0;
}
