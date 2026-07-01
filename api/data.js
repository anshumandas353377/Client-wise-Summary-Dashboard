// api/data.js — Vercel serverless proxy → Google Apps Script
// Single call: ?action=all returns meta+summary+wow+mom together
// This avoids 4× parallel sheet reads that cause timeouts.

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyOxt7LYrvR6ahBzlwNpVdtamYwipDth7zKZmwSUMU7ocIK845tig7wo9m1LkvswR_1/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action  = req.query.action  || 'all';
  const nocache = req.query.nocache === '1' ? '&nocache=1' : '';
  const url     = `${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}${nocache}`;

  console.log(`[proxy] → ${action}  ${url}`);

  // AbortController with 50s timeout (Vercel maxDuration is 55s)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal:    controller.signal,
      headers:  { 'User-Agent': 'Vercel-Proxy/1.0' }
    });
    clearTimeout(timer);

    const text = await response.text();
    console.log(`[proxy] ← status=${response.status}  bytes=${text.length}`);

    if (!response.ok) {
      res.status(502).json({ error: `Apps Script HTTP ${response.status}`, detail: text.slice(0,300) });
      return;
    }

    // Apps Script sometimes returns an HTML error/login page instead of JSON
    if (text.trim().startsWith('<')) {
      console.error('[proxy] Got HTML — deployment may not be set to "Anyone"');
      res.status(502).json({
        error: 'Apps Script returned HTML instead of JSON. Re-deploy with Access = "Anyone".',
        detail: text.slice(0, 200)
      });
      return;
    }

    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      res.status(502).json({ error: 'Invalid JSON from Apps Script', detail: text.slice(0, 300) });
      return;
    }

    if (data && data.error) {
      console.error('[proxy] Apps Script error:', data.error);
      res.status(500).json(data);
      return;
    }

    // Cache at Vercel CDN edge for 5 min; stale-while-revalidate for 60s extra
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(data);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error('[proxy] Timed out after 50s');
      res.status(504).json({
        error: 'Apps Script timed out (>50s). Try again — subsequent loads use cache and are fast.',
        tip: 'First load after deployment always reads the full Base sheet. Subsequent loads hit Apps Script cache (5 min TTL).'
      });
    } else {
      console.error('[proxy] fetch error:', err.message);
      res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
  }
}
