/**
 * Provider-neutral RepoFinisher smoke verification.
 *
 * Production topology:
 *   frontend -> Netlify
 *   API      -> persistent Render service
 *   auth/db  -> Supabase
 *
 * This deliberately validates the seams between those services instead of
 * assuming one host serves the entire application.
 */
const apiUrl = process.env.API_URL || process.env.STAGING_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const frontendUrl = process.env.FRONTEND_URL || null;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
const expectedFrontendOrigin = frontendUrl ? new URL(frontendUrl).origin : null;

async function request(label, target, init = {}, validate = async (response) => response.ok) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(target, { redirect: 'manual', ...init, signal: controller.signal });
    const passed = await validate(response);
    console.log(`[SMOKE ${passed ? 'PASS' : 'FAIL'}] ${label} -> ${response.status}`);
    if (!passed) console.error(`[SMOKE ERROR] ${label} returned an unexpected response.`);
    return passed;
  } catch (error) {
    console.error(`[SMOKE ERROR] ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkApiHealth() {
  return request('Render API /api/healthz', new URL('/api/healthz', apiUrl), {}, async (response) => {
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.status === 'ok';
  });
}

async function checkAiStatusRoute() {
  const target = new URL('/api/preferences/ai-status', apiUrl);
  return request('Render API /api/preferences/ai-status route', target, {}, async (response) => {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const body = await response.text();

    // This endpoint is authenticated, so an anonymous request should be JSON
    // 401. A 404 or HTML response means the SPA is pointed at the wrong host or
    // the persistent API was deployed without the preferences router.
    return response.status === 401 && contentType.includes('application/json') && !/<html|<!doctype html/i.test(body);
  });
}

async function checkFrontend() {
  if (!frontendUrl) {
    console.log('[SMOKE SKIP] FRONTEND_URL not supplied.');
    return true;
  }
  return request('Netlify frontend', frontendUrl, {}, async (response) => {
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    return contentType.includes('text/html') && /<html|<!doctype html/i.test(body) && body.length > 200;
  });
}

async function checkCorsSeam() {
  if (!expectedFrontendOrigin) {
    console.log('[SMOKE SKIP] CORS seam check requires FRONTEND_URL.');
    return true;
  }
  const target = new URL('/api/preferences/ai-status', apiUrl);
  return request('Frontend -> API CORS preflight', target, {
    method: 'OPTIONS',
    headers: {
      Origin: expectedFrontendOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  }, async (response) => {
    const allowed = response.headers.get('access-control-allow-origin');
    return response.ok && allowed === expectedFrontendOrigin;
  });
}

async function checkSupabase() {
  if (!supabaseUrl) {
    console.log('[SMOKE SKIP] SUPABASE_URL not supplied.');
    return true;
  }
  return request('Supabase Auth health', new URL('/auth/v1/health', supabaseUrl), {}, async (response) => response.ok);
}

async function runSmokeSuite() {
  console.log(`RepoFinisher smoke verification\nAPI: ${apiUrl}\nFrontend: ${frontendUrl || '(not supplied)'}\nSupabase: ${supabaseUrl || '(not supplied)'}`);
  const results = await Promise.all([
    checkApiHealth(),
    checkAiStatusRoute(),
    checkFrontend(),
    checkCorsSeam(),
    checkSupabase(),
  ]);
  const failures = results.filter((result) => !result).length;
  if (failures) {
    console.error(`RepoFinisher smoke verification failed: ${failures}/${results.length} checks failed.`);
    process.exit(process.env.CI_STRICT_SMOKE ? 1 : 0);
  }
  console.log('RepoFinisher smoke verification passed.');
}

if (process.argv[1] && process.argv[1].endsWith('smoke-check.mjs')) {
  await runSmokeSuite();
}
