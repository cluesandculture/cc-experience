const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://cluesandculture.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const raw = await redis.get(`token:${token}`);

    if (!raw) {
      return res.status(401).json({ state: 'expired' });
    }

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const now = new Date();
    const previewAt = new Date(data.previewAt);
    const activeAt = new Date(data.activeAt);

    let state;
    if (now >= activeAt) {
      state = 'active';
    } else if (now >= previewAt) {
      state = 'preview';
    } else {
      state = 'preview';
    }

    return res.status(200).json({
      state,
      route: data.route,
      diet: data.diet || 'standard',
      activeAt: data.activeAt,
      expiresAt: data.expiresAt
    });

  } catch (err) {
    console.error('validate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
