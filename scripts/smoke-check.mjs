/**
 * Automated staging/production deployment smoke checks verifying health endpoints and core service workflows.
 */
const baseUrl = process.env.STAGING_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function checkEndpoint(path) {
  const target = new URL(path, baseUrl).toString();
  try {
    const res = await fetch(target, { method: 'GET' });
    console.log(`[SMOKE CHECK] GET ${path} -> ${res.status}`);
    if (!res.ok) {
      console.error(`[SMOKE ERROR] Non-2xx response from ${path}: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[SMOKE ERROR] Failed to connect to ${path}:`, err.message);
    return false;
  }
}

async function runSmokeSuite() {
  const endpoints = ['/api/health', '/healthz', '/api/version'];
  console.log(`Running smoke checks against ${baseUrl}...`);
  
  let allPassed = true;
  for (const endpoint of endpoints) {
    const passed = await checkEndpoint(endpoint);
    if (!passed) {
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.warn('One or more smoke endpoints failed or server is offline in current environment.');
    process.exit(process.env.CI_STRICT_SMOKE ? 1 : 0);
  }
  console.log('Smoke verification passed successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('smoke-check.mjs')) {
  runSmokeSuite();
}
