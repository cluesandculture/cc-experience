// /api/send-vendor-notice.js
// Called by QStash on Thursday 8:45 AM ET (for Saturday) and Friday 8:45 AM ET (for Sunday)
// Queries Shopify for orders on the target date, aggregates guest info,
// and sends a vendor summary email via Klaviyo to all food stop contacts

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;

// --- Shopify GraphQL: fetch orders by booking_date tag or attribute ---
async function getOrdersForDate(targetDate) {
  // targetDate format: YYYY-MM-DD
  // We query orders created in a wide window and filter by booking_date attribute
  const query = `
    {
      orders(first: 250, query: "status:any") {
        edges {
          node {
            id
            name
            customer {
              firstName
              lastName
              email
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  variant {
                    title
                  }
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  `;

  const response = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Shopify API error: ${err}`);
  }

  const data = await response.json();
  const allOrders = data.data.orders.edges.map((e) => e.node);

  // Filter orders where booking_date custom attribute matches targetDate
  return allOrders.filter((order) => {
    const bookingAttr = order.customAttributes?.find(
      (a) => a.key === 'booking_date' || a.key === 'Booking Date'
    );
    return bookingAttr?.value === targetDate;
  });
}

// --- Shopify GraphQL: fetch food stops from metaobjects ---
async function getFoodStops() {
  const query = `
    {
      metaobjects(type: "stop", first: 50) {
        edges {
          node {
            handle
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;

  const response = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2026-04/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Shopify metaobjects error: ${err}`);
  }

  const data = await response.json();
  const stops = data.data.metaobjects.edges.map((e) => {
    const fields = {};
    e.node.fields.forEach((f) => (fields[f.key] = f.value));
    return { handle: e.node.handle, ...fields };
  });

  // Only return food stops
  return stops.filter((s) => s.stop_type === 'food');
}

// --- Send vendor email via Klaviyo transactional send ---
async function sendVendorEmail({ stop, guests, targetDate, totalStandard, totalVegetarian }) {
  const totalGuests = guests.length;
  const amountDue = (parseFloat(stop.vendor_rate || 0) * totalGuests).toFixed(2);

  const guestRows = guests
    .map(
      (g) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${g.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${g.preference}</td></tr>`
    )
    .join('');

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;">
      <h2 style="color:#1a1a1a;">Clues & Culture — Guest Summary</h2>
      <p><strong>Experience Date:</strong> ${targetDate}</p>
      <p><strong>Stop:</strong> ${stop.stop_name || stop.handle}</p>
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
        <tbody>
          ${guestRows}
        </tbody>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
      <p><strong>Amount Due from Clues & Culture:</strong> $${amountDue}</p>
      <p style="color:#888;font-size:12px;">This is an automated notice from Clues & Culture. Questions? Email info@cluesandculture.com</p>
    </div>
  `;

  // Build recipient list: primary contact email + vendor primary email + secondary
  const toEmail = stop.primary_contact_email || stop.vendor_primary_email;
  const ccEmails = [
    stop.vendor_primary_email,
    stop.secondary_contact_email,
  ].filter((e) => e && e !== toEmail);

  if (!toEmail) {
    console.warn(`No email found for stop: ${stop.handle}`);
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
          stop_name: stop.stop_name || stop.handle,
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
    throw new Error(`Klaviyo error for ${toEmail}: ${err}`);
  }

  console.log(`Vendor notice sent to ${toEmail} for stop: ${stop.handle}`);
}

// --- Main handler ---
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // QStash will pass target_date in the body, or we calculate it
  // target_date should be the experience date (Saturday or Sunday)
  let { target_date } = body;

  if (!target_date) {
    // Auto-calculate: if today is Thursday, target Saturday; if Friday, target Sunday
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay(); // 4 = Thursday, 5 = Friday
    const daysAhead = day === 4 ? 2 : day === 5 ? 2 : 2;
    const target = new Date(now);
    target.setDate(now.getDate() + daysAhead);
    target_date = target.toISOString().split('T')[0];
  }

  console.log('send-vendor-notice firing for date:', target_date);

  try {
    // 1. Get all orders for the target date
    const orders = await getOrdersForDate(target_date);
    console.log(`Found ${orders.length} orders for ${target_date}`);

    if (orders.length === 0) {
      return res.status(200).json({ success: true, message: 'No orders for this date', target_date });
    }

    // 2. Aggregate guest list
    const guests = orders.map((order) => {
      const firstName = order.customer?.firstName || '';
      const lastName = order.customer?.lastName || '';
      const name = `${firstName} ${lastName}`.trim() || order.customer?.email || 'Guest';

      // Get meal preference from line item variant
      const lineItem = order.lineItems?.edges?.[0]?.node;
      const preference = lineItem?.variant?.title || 'Standard';

      return { name, preference };
    });

    const totalStandard = guests.filter(
      (g) => !g.preference.toLowerCase().includes('vegetarian')
    ).length;
    const totalVegetarian = guests.filter((g) =>
      g.preference.toLowerCase().includes('vegetarian')
    ).length;

    // 3. Get food stops
    const foodStops = await getFoodStops();
    console.log(`Found ${foodStops.length} food stops`);

    // 4. Send email to each food stop
    const results = await Promise.allSettled(
      foodStops.map((stop) =>
        sendVendorEmail({ stop, guests, targetDate: target_date, totalStandard, totalVegetarian })
      )
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      failures.forEach((f) => console.error('Send failure:', f.reason));
    }

    return res.status(200).json({
      success: true,
      target_date,
      total_orders: orders.length,
      food_stops_notified: foodStops.length - failures.length,
      failures: failures.length,
    });
  } catch (err) {
    console.error('send-vendor-notice error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};
