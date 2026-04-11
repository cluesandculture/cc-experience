const { Redis } = require('@upstash/redis');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('BookX payload:', JSON.stringify(req.body));

  const body = req.body || {};

  const booking_date = body.booking_date || body.date || body.bookingDate;
  const route = body.route || body.service || body.serviceName || 'west-end';
  const guest_email = body.guest_email || body.email || body.customerEmail;
  const guest_name = body.guest_name || body.name || body.customerName;
  const diet_preference = body.diet_preference || body.dietPreference || body.diet || 'standard';

  if (!booking_date) {
    return res.status(200).json({ received: true });
  }

  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const previewAt = new Date(booking_date + 'T00:00:00');
    previewAt.setDate(previewAt.getDate() - 1);
    previewAt.setHours(17, 0, 0, 0);

    const activeAt = new Date(booking_date + 'T11:30:00');
    const expiresAt = new Date(booking_date + 'T15:00:00');
    const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

    const lookupKey = `lookup:${route}:${booking_date}`;
    const existing = await redis.get(lookupKey);

    let token;
    if (existing) {
      token = existing;
    } else {
      token = uuidv4();
      const tokenData = {
        token,
        route,
        bookingDate: booking_date,
        previewAt: previewAt.toISOString(),
        activeAt: activeAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        diet: diet_preference,
        createdAt: new Date().toISOString()
      };

      await redis.set(`token:${token}`, JSON.stringify(tokenData), {
        exat: expiresAtUnix
      });

      await redis.set(lookupKey, token, { exat: expiresAtUnix });
    }

    return res.status(200).json({
      token,
      route,
      booking_date,
      link: `https://cluesandculture.com/pages/west-end-route?token=${token}`,
      preview_at: previewAt.toISOString(),
      active_at: activeAt.toISOString(),
      expires_at: expiresAt.toISOString()
    });

  } catch (err) {
    console.error('create-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
