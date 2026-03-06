import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS
  const allowedOrigins = [
    'https://www.lazyweightloss.com',
    'https://lazyweightloss.com',
    'https://slimbloom.vercel.app',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body || {};
  if (!phone || !/^\+1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from('phone_leads')
    .select('id')
    .eq('phone', phone)
    .limit(1);

  if (error) {
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ exists: data && data.length > 0 });
}
