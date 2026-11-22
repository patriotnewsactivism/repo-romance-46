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
      // `repo` covers private repository read/write. `read:user` and
      // `user:email` are what GitHub needs to identify the account; without
      // them the connection works but the profile is incomplete.
      scopes: 'repo read:user user:email',
      redirectTo: `${redirectOrigin}${import.meta.env.BASE_URL}auth/callback`
    }
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
