# Gemini 3.7 Flash default

Repo Romance now treats Google Gemini as the platform-default AI provider.

- Default provider: `google`
- Default model: `gemini-3.7-flash`
- Server environment fallback: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- User BYOK credentials still override the platform credential.
- Historical `github_models` preferences are redirected to Google by the credential loader.

## Supabase Edge Function Secrets

If the Gemini key is stored as a Supabase Edge Function secret, it is available only inside Supabase Edge Functions. The current Vercel-hosted API cannot read that value directly. To consume that secret without duplicating it into Vercel, route Gemini calls through an authenticated Supabase Edge Function.

Never expose the Gemini key to frontend code or return it through API responses.
