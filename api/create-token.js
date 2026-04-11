const { Redis } = require('@upstash/redis');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('BookX payload:', JSON.stringify(req.body));

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  if (!body.topic || !['booking-created', 'booking-updated'].includes(body.topic)) {
    return res.status(200).json({ received: true });
  }

  const payload = body.payload || {};

  const rawDate = payload.bookingDate || '';
  const parsedDate = new Date(rawDate);
  const booking_date = !isNaN(parsedDate)
    ? parsedDate.toISOString().split('T')[0]
    : null;

  if (!booking_date) {
    return res.status(200).json({ received: true, error: 'Could not parse date' });
  }

  const productName = (payload.productName || '').toLowerCase();
  const route = productName
    .split(':')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

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

    // On reschedule — delete old token
    if (body.topic === 'booking-updated') {
      const timeline = payload.timeline || [];
      const rescheduleEntry = timeline.find(t => t.cardTitle && t.cardTitle.includes('Booking date'));
      if (rescheduleEntry && rescheduleEntry.notes) {
        const notesParts = rescheduleEntry.notes.split(' to ');
        if (notesParts[0]) {
          const oldRawDate = notesParts[0].trim();
          const oldParsed = new Date(oldRawDate);
          if (!isNaN(oldParsed)) {
            const oldDate = oldParsed.toISOString().split('T')[0];
            const oldLookupKey = `lookup:${route}:${oldDate}`;
            const oldToken = await redis.get(oldLookupKey);
            if (oldToken) {
              await redis.del(`token:${oldToken}`);
              await redis.del(oldLookupKey);
              console.log('Old token deleted for', route, oldDate);
            }
          }
        }
      }
    }

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
