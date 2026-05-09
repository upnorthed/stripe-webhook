const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// Raw body required for Stripe signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const name = session.customer_details?.name ?? '';
    const email = session.customer_details?.email ?? '';
    const amount = ((session.amount_total ?? 0) / 100).toFixed(0);

    // 1. Insert into Supabase customers
    const { error: dbError } = await supabase
      .from('customers')
      .insert({ sender_name: name, status: 'onboarding' });

    if (dbError) {
      console.error('Supabase error:', dbError.message);
      return res.status(500).json({ error: 'Database insert failed' });
    }

    // 2. Notify chris
    const { error: notifyError } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: 'chris@10milechris.com',
      subject: `New customer: ${name}`,
      text: `New customer: ${name} ${email} just paid $${amount}`,
    });
    if (notifyError) console.error('Notify email error:', notifyError.message);

    // 3. Welcome email to customer
    const { error: welcomeError } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "You're in — welcome!",
      html: `
        <p>Hi ${name},</p>
        <p>You're in — here's your onboarding link:</p>
        <p><a href="https://10milechris.com/onboarding">10milechris.com/onboarding</a></p>
      `,
    });
    if (welcomeError) console.error('Welcome email error:', welcomeError.message);

    console.log(`Processed checkout for ${name} (${email})`);
  }

  res.json({ received: true });
});

app.post('/onboarding', express.json(), async (req, res) => {
  const { business_name, website, vertical, sender_name, cta_type, cta_value, place_id } = req.body;

  if (!business_name || !sender_name || !place_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { error } = await supabase
    .from('customers')
    .insert({
      business_name,
      website,
      vertical,
      sender_name,
      cta_type,
      cta_value,
      place_id,
      status: 'active',
    });

  if (error) {
    console.error('Onboarding DB error:', error.message);
    return res.status(500).json({ error: 'Failed to save onboarding data' });
  }

  console.log(`Onboarding saved for ${sender_name} — ${business_name}`);
  res.json({ success: true });
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
