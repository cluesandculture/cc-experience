// /api/send-reminder.js
// Called by QStash at the scheduled time (day before event at 5pm ET)
// Fires a Klaviyo event that triggers the Day Before email flow

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  const { email, clue_link, booking_date, booking_route, booking_diet, guest_name } = body;

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  console.log('send-reminder firing for', email, booking_date);

  try {
    // Fire a Klaviyo event — "Day Before Reminder"
    // This triggers the Klaviyo flow / template send
    const response = await fetch('https://a.klaviyo.com/api/events/', {
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
                  email: email,
                  properties: {
                    clue_link,
                    booking_date,
                    booking_route,
                    booking_diet,
                    guest_name
                  }
                }
              }
            },
            metric: {
              data: {
                type: 'metric',
                attributes: { name: 'Day Before Reminder' }
              }
            },
            properties: {
              clue_link,
              booking_date,
              booking_route,
              booking_diet,
              guest_name
            }
          }
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Klaviyo error:', err);
      return res.status(500).json({ error: 'Klaviyo send failed' });
    }

    console.log('Day Before Reminder event fired for', email);
    return res.status(200).json({ success: true, email, booking_date });

  } catch (err) {
    console.error('send-reminder error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

