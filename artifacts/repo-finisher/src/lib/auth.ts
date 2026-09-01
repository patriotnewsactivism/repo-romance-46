import { supabase } from '@/integrations/supabase/client';

const canonicalProductionOrigin = 'https://portfolio.donmatthews.live';
const legacyProductionHostnames = new Set(['repofinisher.donmatthews.live']);

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithGitHub() {
  const redirectOrigin = legacyProductionHostnames.has(window.location.hostname)
    ? canonicalProductionOrigin
    : window.location.origin;

  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: 'repo',
      redirectTo: `${redirectOrigin}${import.meta.env.BASE_URL}auth/callback`
    }
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
