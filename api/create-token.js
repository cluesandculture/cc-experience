const { Redis } = require('@upstash/redis');
const { v4: uuidv4 } = require('uuid');

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

    const {
      order_id,
      booking_date,
      route,
      guest_email,
      guest_name,
      diet_preference
    } = req.body;

    if (!booking_date || !route) {
      return res.status(400).json({ error: 'Missing booking_date or route' });
    }

    const previewAt = new Date(booking_date + 'T00:00:00');
    previewAt.setDate(previewAt.getDate() - 1);
    previewAt.setHours(17, 0, 0, 0);

    const activeAt = new Date(booking_date + 'T11:30:00');
    const expiresAt = new Date(booking_date + 'T15:00:00');
    const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

    const lookupKey = `lookup:${route}:${booking_date
