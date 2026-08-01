/**
 * Kicks off the app's OWN GitHub OAuth flow (separate from Supabase Auth sign-in).
 * This grants repo-finisher's backend an access token stored in `github_connections`,
 * which is what actually lets the app read/analyze the user's repositories.
 */
export function initiateGithubConnect() {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
  if (!clientId) {
    console.error('VITE_GITHUB_CLIENT_ID is not configured');
    return;
  }
  const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL}github/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('redirect_uri', redirectUri);
  window.location.href = url.toString();
}
