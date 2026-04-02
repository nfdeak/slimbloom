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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Extract JWT
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = authHeader.replace('Bearer ', '');

  // 2. Parse body
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  // 3. Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 4. Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // 5. Check if user already has a linked membership
  const { data: existing } = await supabase
    .from('memberships')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return res.status(200).json({ success: true, message: 'Already linked' });
  }

  // 6. Find unlinked membership by email
  const { data: memberships, error: dbError } = await supabase
    .from('memberships')
    .select('*')
    .eq('whop_user_email', email.toLowerCase())
    .is('user_id', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (dbError) {
    console.error('DB error:', dbError);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!memberships || memberships.length === 0) {
    // Also try matching where user_id is already set to someone else — don't steal
    // Just check if the email exists at all
    const { data: anyMembership } = await supabase
      .from('memberships')
      .select('id, user_id')
      .eq('whop_user_email', email.toLowerCase())
      .limit(1);

    if (anyMembership && anyMembership.length > 0) {
      return res.status(404).json({ error: 'This membership is already linked to another account. Please contact support.' });
    }
    return res.status(404).json({ error: 'No membership found with that email. Please double-check the email you used for payment.' });
  }

  // 7. Link the membership to this user
  const membership = memberships[0];
  const { error: linkError } = await supabase
    .from('memberships')
    .update({ user_id: user.id })
    .eq('id', membership.id);

  if (linkError) {
    console.error('Link error:', linkError);
    return res.status(500).json({ error: 'Failed to link membership' });
  }

  console.log(`Linked membership ${membership.whop_membership_id} to user ${user.id} via email ${email}`);
  return res.status(200).json({ success: true, subscription: { ...membership, user_id: user.id } });
}
