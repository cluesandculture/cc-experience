// /api/shopify-auth.js
// One-time use: exchanges OAuth code for a permanent access token
// Step 1: Visit /api/shopify-auth to start OAuth
// Step 2: Shopify redirects back with ?code=xxx
// Step 3: We exchange the code for an access token and display it

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SCOPES = 'read_orders,read_metaobjects,read_customers';
const REDIRECT_URI = `https://cc-experience.vercel.app/api/shopify-auth`;

module.exports = async function handler(req, res) {
  const { code, shop } = req.query;

  // Step 2: Handle the OAuth callback from Shopify
  if (code) {
    try {
      const tokenResponse = await fetch(
        `https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
          }),
        }
      );

      const data = await tokenResponse.json();

      if (data.access_token) {
        // Display the token — copy this into your Vercel env as SHOPIFY_ACCESS_TOKEN
        return res.status(200).send(`
          <html>
            <body style="font-family:sans-serif;padding:40px;">
              <h2>✅ OAuth Success!</h2>
              <p>Copy this access token and add it to Vercel as <strong>SHOPIFY_ACCESS_TOKEN</strong>:</p>
              <code style="background:#f0f0f0;padding:12px;display:block;font-size:14px;word-break:break-all;">
                ${data.access_token}
              </code>
              <p style="color:#888;margin-top:20px;">Once saved in Vercel, you can delete this /api/shopify-auth.js file.</p>
            </body>
          </html>
        `);
      } else {
        return res.status(400).send(`<pre>${JSON.stringify(data, null, 2)}</pre>`);
      }
    } catch (err) {
      return res.status(500).send(`Error: ${err.message}`);
    }
  }

  // Step 1: Redirect to Shopify OAuth
  const authUrl = `https://${SHOPIFY_DOMAIN}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return res.redirect(authUrl);
};
