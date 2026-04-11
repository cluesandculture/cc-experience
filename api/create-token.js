const { Redis } = require('@upstash/redis');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('BookX payload:', JSON.stringify(req.body));

  // Handle verification ping
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  if (!body.topic || body.topic !== 'booking-created') {
    return res.status(200).json({ received: true });
  }

  const payload = body.payload || {};

  // Parse booking date from "Sat, 18 Apr 2026" → "2026-04-18"
  const rawDate = payload.bookingDate || '';
  const parsedDate = new Date(rawDate);
  const booking_date = !isNaN(parsedDate)
    ? parsedDate.toISOString().split('T')[0]
    : null;

  if (!booking_date) {
    return res.status(200).json({ received: true, error: 'Could not parse date' });
  }

  // Map route from product name
  const productName = (payload.productName || '').toLowerCase();
  // Auto-generate route slug from product name
  // "West End: Flavor, Legacy & the City's Rhythm" → "west-end"
  // "Southside: Hidden Gems & Sweet Moments" → "southside"
  // "Charleston Battery: History & Bites" → "charleston-battery"
  const route = productName
    .split(':')[0]          // take everything before the colon
    .trim()                 // remove whitespace
    .toLowerCase()          // lowercase
    .replace(/[^a-z0-9]+/g, '-')  // replace non-alphanumeric with hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens

  // Map diet from variant name
  const variantName = (payload.variantName || '').toLowerCase();
  const diet = variantName.includes('vegetarian') ? 'vegetarian' : 'standard';

  const guest_email = payload.email || '';
  const guest_name = payload.customerDisplayName || '';
  const order_id = payload.orderName || '';

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
        diet,
        guestEmail: guest_email,
        guestName: guest_name,
        orderId: order_id,
        createdAt: new Date().toISOString()
      };

      await redis.set(`token:${token}`, JSON.stringify(tokenData), {
        exat: expiresAtUnix
      });

      await redis.set(lookupKey, token, { exat: expiresAtUnix });
    }

    console.log('Token created:', token, 'for', route, booking_date, guest_email);

    // Push token link to Klaviyo profile
if (guest_email && process.env.KLAVIYO_PRIVATE_KEY) {
  try {
    await fetch('https://a.klaviyo.com/api/profile-import/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
        'Content-Type': 'application/json',
        'revision': '2024-02-15'
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email: guest_email,
            properties: {
              clue_link: `https://cluesandculture.com/pages/west-end-route?token=${token}`,
              booking_date: booking_date,
              booking_route: route,
              booking_diet: diet
            }
          }
        }
      })
    });
    console.log('Klaviyo profile updated for', guest_email);
  } catch (klaviyoErr) {
    console.error('Klaviyo update failed:', klaviyoErr);
  }
}
    return res.status(200).json({
      token,
      route,
      booking_date,
      diet,
      guest_email,
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
