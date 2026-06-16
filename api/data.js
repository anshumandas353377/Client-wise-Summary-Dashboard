// api/data.js — Vercel serverless proxy → Google Apps Script
// Browser calls /api/data?action=xxx (same origin). This calls Apps Script
// server-side (no CORS) and returns JSON. Logs to Vercel function logs.

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyOxt7LYrvR6ahBzlwNpVdtamYwipDth7zKZmwSUMU7ocIK845tig7wo9m1LkvswR_1/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action || 'meta';
  const nocache = req.query.nocache === '1' ? '&nocache=1' : '';
  const url = `${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}${nocache}`;

  console.log(`[proxy] action=${action} → ${url}`);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Vercel-Proxy/1.0' }
    });

    const text = await response.text();
    console.log(`[proxy] status=${response.status} bytes=${text.length}`);

    if (!response.ok) {
      console.error(`[proxy] HTTP ${response.status}: ${text.slice(0, 300)}`);
      res.status(502).json({
        error: `Apps Script HTTP ${response.status}`,
        detail: text.slice(0, 500)
      });
      return;
    }

    // Apps Script sometimes returns an HTML login/error page instead of JSON
    // (happens when deployment access is NOT "Anyone"). Detect & report clearly.
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) {
      console.error('[proxy] Got HTML instead of JSON — likely access not set to Anyone');
      res.status(502).json({
        error: 'Apps Script returned HTML, not JSON. Set deployment access to "Anyone" and redeploy.',
        detail: trimmed.slice(0, 300)
      });
      return;
    }

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      console.error('[proxy] JSON parse failed:', trimmed.slice(0, 300));
      res.status(502).json({
        error: 'Invalid JSON from Apps Script',
        detail: trimmed.slice(0, 500)
      });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (err) {
    console.error('[proxy] fetch failed:', err.message);
    res.status(500).json({ error: 'Proxy fetch failed: ' + err.message });
  }
}
