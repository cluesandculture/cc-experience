const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-bookeasy-secret'] || req.headers['x-webhook-secret'];
  if (process.env.BOOKEASY_WEBHOOK_SECRET && secret !== process.env.BOOKEASY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const { booking_date, route } = req.body;

    if (!booking_date || !route) {
      return res.status(400).json({ error: 'Missing booking_date or route' });
    }

    const lookupKey = `lookup:${route}:${booking_date}`;
    const token = await redis.get(lookupKey);

    if (token) {
      await redis.del(`token:${token}`);
      await redis.del(lookupKey);
    }

    return res.status(200).json({ cancelled: true, route, booking_date });

  } catch (err) {
    console.error('cancel-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
