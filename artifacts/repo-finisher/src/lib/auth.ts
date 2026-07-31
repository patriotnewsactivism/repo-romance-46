import { supabase } from '@/integrations/supabase/client';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithGitHub() {
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: 'repo',
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`
    }
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
