// /api/send-vendor-notice.js
// Called by QStash on Thursday 8:45 AM ET (for Saturday) and Friday 8:45 AM ET (for Sunday)
// Queries Klaviyo for profiles with booking_date matching the target date,
// aggregates guest info, and sends a vendor summary email via Klaviyo

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;

// --- Query Klaviyo profiles by booking_date property ---
async function getProfilesForDate(targetDate) {
  const filter = encodeURIComponent(`equals(properties["booking_date"],"${targetDate}")`);
  const url = `https://a.klaviyo.com/api/profiles/?filter=${filter}&page[size]=100`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      revision: '2024-02-15',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Klaviyo profiles error: ${err}`);
  }

  const data = await response.json();
  return data.data || [];
}

// --- Food stop config ---
// Add vendor emails as Vercel env vars, or set FOOD_STOPS_CONFIG as a JSON string
function getFoodStops() {
  if (process.env.FOOD_STOPS_CONFIG) {
    try {
      return JSON.parse(process.env.FOOD_STOPS_CONFIG);
    } catch (e) {
      console.error('Failed to parse FOOD_STOPS_CONFIG:', e);
    }
  }

  return [
    {
      stop_name: 'Glaciers Italian Ice',
      vendor_rate: 5,
      primary_contact_email: process.env.VENDOR_1_EMAIL || '',
      vendor_primary_email: process.env.VENDOR_1_BIZ_EMAIL || '',
      secondary_contact_email: process.env.VENDOR_1_SECONDARY_EMAIL || '',
    },
    {
      stop_name: 'Mr. Everything Cafe',
      vendor_rate: 0,
      primary_contact_email: process.env.VENDOR_2_EMAIL || '',
      vendor_primary_email: process.env.VENDOR_2_BIZ_EMAIL || '',
      secondary_contact_email: process.env.VENDOR_2_SECONDARY_EMAIL || '',
    },
    {
      stop_name: 'West End Park',
      vendor_rate: 0,
      primary_contact_email: process.env.VENDOR_3_EMAIL || '',
      vendor_primary_email: process.env.VENDOR_3_BIZ_EMAIL || '',
      secondary_contact_email: process.env.VENDOR_3_SECONDARY_EMAIL || '',
    },
    {
      stop_name: 'Atlantucky Brewing',
      vendor_rate: 0,
      primary_contact_email: process.env.VENDOR_4_EMAIL || '',
      vendor_primary_email: process.env.VENDOR_4_BIZ_EMAIL || '',
      secondary_contact_email: process.env.VENDOR_4_SECONDARY_EMAIL || '',
    },
  ].filter((s) => s.primary_contact_email);
}

// --- Send vendor summary email via Klaviyo event ---
async function sendVendorEmail({ stop, guests, targetDate, totalStandard, totalVegetarian }) {
  const totalGuests = guests.length;
  const amountDue = (parseFloat(stop.vendor_rate || 0) * totalGuests).toFixed(2);

  const guestRows = guests
    .map(
      (g) => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${g.name}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${g.preference}</td>
      </tr>`
    )
    .join('');

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;">
      <h2 style="color:#1a1a1a;">Clues & Culture — Guest Summary</h2>
      <p><strong>Experience Date:</strong> ${targetDate}</p>
      <p><strong>Your Stop:</strong> ${stop.stop_name}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
      <p><strong>Total Guests:</strong> ${totalGuests}</p>
      <p><strong>Standard:</strong> ${totalStandard} &nbsp;|&nbsp; <strong>Vegetarian:</strong> ${totalVegetarian}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:8px 12px;text-align:left;">Guest Name</th>
            <th style="padding:8px 12px;text-align:left;">Meal Preference</th>
          </tr>
        </thead>
        <tbody>${guestRows}</tbody>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
      <p><strong>Amount Due from Clues & Culture:</strong> $${amountDue}</p>
      <p style="color:#888;font-size:12px;">
        Questions? Email <a href="mailto:info@cluesandculture.com">info@cluesandculture.com</a>
      </p>
    </div>
  `;

  const toEmail = stop.primary_contact_email;
  const ccEmails = [stop.vendor_primary_email, stop.secondary_contact_email].filter(
    (e) => e && e !== toEmail
  );

  if (!toEmail) {
    console.warn(`No email for stop: ${stop.stop_name} — skipping`);
    return;
  }

  const payload = {
    data: {
      type: 'event',
      attributes: {
        profile: {
          data: {
            type: 'profile',
            attributes: { email: toEmail },
          },
        },
        metric: {
          data: {
            type: 'metric',
            attributes: { name: 'Vendor Notice' },
          },
        },
        properties: {
          stop_name: stop.stop_name,
          experience_date: targetDate,
          total_guests: totalGuests,
          total_standard: totalStandard,
          total_vegetarian: totalVegetarian,
          amount_due: amountDue,
          guest_list: guests,
          cc_emails: ccEmails,
          email_html: emailHtml,
        },
      },
    },
  };

  const response = await fetch('https://a.klaviyo.com/api/events/', {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      'Content-Type': 'application/json',
      revision: '2024-02-15',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Klaviyo send error for ${toEmail}: ${err}`);
  }

  console.log(`Vendor notice sent to ${toEmail} for ${stop.stop_name}`);
}

// --- Main handler ---
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  let { target_date } = body;

  if (!target_date || target_date === 'auto') {
    const now = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
    );
    const target = new Date(now);
    target.setDate(now.getDate() + 2);
    target_date = target.toISOString().split('T')[0];
  }

  console.log('send-vendor-notice firing for date:', target_date);

  try {
    const profiles = await getProfilesForDate(target_date);
    console.log(`Found ${profiles.length} profiles for ${target_date}`);

    if (profiles.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No bookings found for this date',
        target_date,
      });
    }

    const guests = profiles.map((profile) => {
      const attrs = profile.attributes || {};
      const props = attrs.properties || {};
      const firstName = attrs.first_name || '';
      const lastName = attrs.last_name || '';
      const name = `${firstName} ${lastName}`.trim() || attrs.email || 'Guest';
      const preference = props.booking_diet || 'Standard';
      return { name, preference };
    });

    const totalStandard = guests.filter(
      (g) => !g.preference.toLowerCase().includes('vegetarian')
    ).length;
    const totalVegetarian = guests.filter((g) =>
      g.preference.toLowerCase().includes('vegetarian')
    ).length;

    const foodStops = getFoodStops();
    console.log(`Sending to ${foodStops.length} food stops`);

    const results = await Promise.allSettled(
      foodStops.map((stop) =>
        sendVendorEmail({ stop, guests, targetDate: target_date, totalStandard, totalVegetarian })
      )
    );

    const failures = results.filter((r) => r.status === 'rejected');
    failures.forEach((f) => console.error('Send failure:', f.reason));

    return res.status(200).json({
      success: true,
      target_date,
      total_guests: guests.length,
      food_stops_notified: foodStops.length - failures.length,
      failures: failures.length,
    });
  } catch (err) {
    console.error('send-vendor-notice error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
