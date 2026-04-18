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

    // On reschedule — delete old token and cancel old reminder
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

    // All times stored as UTC, converted from ET (EDT = UTC-4, applies Apr–Nov)
    //
    // previewAt  = 5:00pm ET day before  = 21:00 UTC day before
    // activeAt   = 12:00pm ET day of     = 16:00 UTC day of
    // expiresAt  = 11:59pm ET day of     = 03:59 UTC next day

    const previewAt  = new Date(booking_date + 'T21:00:00.000Z');
    previewAt.setUTCDate(previewAt.getUTCDate() - 1); // move back to day before

    const activeAt   = new Date(booking_date + 'T16:00:00.000Z'); // noon ET = 16:00 UTC
    const expiresAt  = new Date(booking_date + 'T03:59:59.000Z'); // 11:59pm ET = next day 03:59 UTC
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 1); // move to next day

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
    console.log('previewAt:', previewAt.toISOString(), '| activeAt:', activeAt.toISOString(), '| expiresAt:', expiresAt.toISOString());

    const clue_link = `https://cluesandculture.com/pages/west-end-route?token=${token}`;

    // Fire Klaviyo Experience Link Ready event + set profile properties
    if (guest_email && process.env.KLAVIYO_PRIVATE_KEY) {
      try {
        await fetch('https://a.klaviyo.com/api/events/', {
          method: 'POST',
          headers: {
            'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
            'Content-Type': 'application/json',
            'revision': '2024-02-15'
          },
          body: JSON.stringify({
            data: {
              type: 'event',
              attributes: {
                profile: {
                  data: {
                    type: 'profile',
                    attributes: {
                      email: guest_email,
                      properties: {
                        clue_link,
                        booking_date,
                        booking_route: route,
                        booking_diet: diet,
                        guest_name
                      }
                    }
                  }
                },
                metric: {
                  data: {
                    type: 'metric',
                    attributes: { name: 'Experience Link Ready' }
                  }
                },
                properties: {
                  clue_link,
                  booking_date,
                  booking_route: route,
                  booking_diet: diet,
                  guest_name
                }
              }
            }
          })
        });
        console.log('Klaviyo event fired for', guest_email);
      } catch (klaviyoErr) {
        console.error('Klaviyo update failed:', klaviyoErr);
      }
    }

    // Schedule day-before reminder via QStash
    // Fires at 5pm ET the day before the event
    // EDT (Apr–Nov): 5pm ET = 21:00 UTC
    if (guest_email && process.env.QSTASH_TOKEN) {
      try {
        const reminderDate = new Date(booking_date + 'T21:00:00.000Z');
        reminderDate.setUTCDate(reminderDate.getUTCDate() - 1); // day before

        const nowMs = Date.now();
        const reminderMs = reminderDate.getTime();

        if (reminderMs > nowMs) {
          const delaySeconds = Math.floor((reminderMs - nowMs) / 1000);

          const reminderPayload = {
            email: guest_email,
            clue_link,
            booking_date,
            booking_route: route,
            booking_diet: diet,
            guest_name
          };

          const qstashRes = await fetch('https://qstash-eu-central-1.upstash.io/v2/publish/https://cc-experience.vercel.app/api/send-reminder', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
              'Content-Type': 'application/json',
              'Upstash-Delay': `${delaySeconds}s`,
              'Upstash-Forward-Content-Type': 'application/json'
            },
            body: JSON.stringify(reminderPayload)
          });

          if (qstashRes.ok) {
            const qstashData = await qstashRes.json();
            console.log('QStash reminder scheduled:', qstashData.messageId, 'fires at', reminderDate.toISOString());
          } else {
            const qstashErr = await qstashRes.text();
            console.error('QStash scheduling failed:', qstashErr);
          }
        } else {
          console.log('Reminder date is in the past, skipping QStash schedule');
        }
      } catch (qstashErr) {
        console.error('QStash error:', qstashErr);
      }
    }

    return res.status(200).json({
      token,
      route,
      booking_date,
      diet,
      guest_email,
      link: clue_link,
      preview_at: previewAt.toISOString(),
      active_at: activeAt.toISOString(),
      expires_at: expiresAt.toISOString()
    });

  } catch (err) {
    console.error('create-token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
