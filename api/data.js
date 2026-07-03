// api/data.js — Vercel serverless proxy → Google Apps Script
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyOxt7LYrvR6ahBzlwNpVdtamYwipDth7zKZmwSUMU7ocIK845tig7wo9m1LkvswR_1/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Build query string — pass all params through to Apps Script
  const params = new URLSearchParams(req.query).toString();
  const url = `${APPS_SCRIPT_URL}?${params}`;
  const action = req.query.action || 'all';

  console.log(`[proxy] → ${action}  ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Vercel-Proxy/1.0' }
    });
    clearTimeout(timer);

    const text = await response.text();
    console.log(`[proxy] ← status=${response.status}  bytes=${text.length}`);

    if (!response.ok) {
      res.status(502).json({ error: `Apps Script HTTP ${response.status}`, detail: text.slice(0,300) });
      return;
    }
    if (text.trim().startsWith('<')) {
      res.status(502).json({ error: 'Apps Script returned HTML. Re-deploy with Access = "Anyone".', detail: text.slice(0,200) });
      return;
    }

    let data;
    try { data = JSON.parse(text); }
    catch (e) { res.status(502).json({ error: 'Invalid JSON from Apps Script', detail: text.slice(0,300) }); return; }

    if (data && data.error && action !== 'logview') {
      console.error('[proxy] Apps Script error:', data.error);
      res.status(500).json(data);
      return;
    }

    // logview and views are not cached (real-time); all = cached 5 min
    if (action === 'all') {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.status(200).json(data);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Apps Script timed out (>50s). Try again — next load hits cache.' });
    } else {
      res.status(500).json({ error: 'Proxy error: ' + err.message });
    }
  }
}
