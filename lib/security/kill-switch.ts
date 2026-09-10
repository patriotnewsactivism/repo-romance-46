/**
 * Global Kill Switch for immediate human override of autonomous operations.
 * Workers poll the kill_switch_status table in Supabase.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function isKillSwitchEngaged(): Promise<boolean> {
  if (process.env.KILL_SWITCH_ENABLED !== 'true') {
    return false; // Feature disabled
  }

  const { data, error } = await supabase
    .from('kill_switch_status')
    .select('engaged, reason, engaged_by, engaged_at')
    .eq('id', 1)
    .single();

  if (error || !data) {
    // Fail closed: if we cannot read status, treat as engaged for safety
    console.warn('Kill switch status unreadable; failing closed');
    return true;
  }

  return Boolean(data.engaged);
}

export async function engageKillSwitch(reason: string, engagedBy: string): Promise<void> {
  const { error } = await supabase
    .from('kill_switch_status')
    .upsert({
      id: 1,
      engaged: true,
      reason,
      engaged_by: engagedBy,
      engaged_at: new Date().toISOString(),
    });

  if (error) throw error;
  console.warn(`[KILL SWITCH ENGAGED] by ${engagedBy}: ${reason}`);
}

export async function disengageKillSwitch(disengagedBy: string): Promise<void> {
  const { error } = await supabase
    .from('kill_switch_status')
    .upsert({
      id: 1,
      engaged: false,
      reason: null,
      engaged_by: null,
      engaged_at: null,
      disengaged_by: disengagedBy,
      disengaged_at: new Date().toISOString(),
    });

  if (error) throw error;
  console.info(`[KILL SWITCH DISENGAGED] by ${disengagedBy}`);
}

/**
 * Call this at the start of every autonomous write path.
 */
export async function assertNotKilled(): Promise<void> {
  if (await isKillSwitchEngaged()) {
    throw new Error('Global Kill Switch is engaged. Autonomous operations halted.');
  }
}
