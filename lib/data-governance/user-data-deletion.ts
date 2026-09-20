/**
 * User Data Deletion Service – implements right-to-be-forgotten and account cleanup.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function deleteUserData(userId: string, reason: string = 'user_request'): Promise<void> {
  console.info(`[DataGovernance] Deleting data for user ${userId}, reason: ${reason}`);

  // Cascade deletion of related records (order matters for FKs)
  const tables = [
    'completion_sessions',
    'completion_plans',
    'operational_memory',
    'github_credentials',
    'ai_preferences',
    'portfolio_analyses',
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) {
      console.error(`Failed to delete from ${table}`, error);
      // Continue; best-effort
    }
  }

  // Anonymize any remaining learning data that cannot be hard-deleted
  await supabase
    .from('cross_repo_patterns')
    .update({ user_id: null, anonymized: true })
    .eq('user_id', userId);

  // Audit log
  await supabase.from('data_governance_audit').insert({
    action: 'user_data_deletion',
    user_id: userId,
    reason,
    performed_at: new Date().toISOString(),
  });
}

export async function disconnectGitHub(userId: string): Promise<void> {
  await supabase.from('github_credentials').delete().eq('user_id', userId);
  await supabase.from('data_governance_audit').insert({
    action: 'github_disconnect',
    user_id: userId,
    performed_at: new Date().toISOString(),
  });
}
