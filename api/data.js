// api/data.js  — Vercel serverless proxy
// Browser calls /api/data?action=xxx  (same origin, no CORS)
// This function calls Apps Script server-side and returns the result.

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyOxt7LYrvR6ahBzlwNpVdtamYwipDth7zKZmwSUMU7ocIK845tig7wo9m1LkvswR_1/exec';

export default async function handler(req, res) {
  // CORS headers (allow your Vercel domain and localhost dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const action = req.query.action || 'meta';
  const url    = `${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}`;

  try {
    // Follow redirects (Apps Script returns 302 before the actual response)
    const response = await fetch(url, {
      redirect: 'follow',
      headers : { 'User-Agent': 'Vercel-Proxy/1.0' }
    });

    if (!response.ok) {
      throw new Error(`Apps Script returned HTTP ${response.status}`);
    }

    const text = await response.text();

    // Validate it's JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON from Apps Script: ${text.slice(0, 200)}`);
    }

    // Cache for 5 minutes at CDN edge
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
