// process-sms-queue: Run on a cron schedule (every hour)
// Checks phone_leads and sends follow-up SMS based on delay_hours
// Handles both non_converter and converter flows
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function sendTwilioSMS(to: string, body: string): Promise<string | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: TWILIO_PHONE_NUMBER,
      Body: body,
    }),
  })

  const data = await resp.json()
  if (resp.ok) {
    return data.sid
  } else {
    console.error('Twilio error:', data)
    return null
  }
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Get all active campaigns
    const { data: campaigns } = await supabase
      .from('sms_campaigns')
      .select('*')
      .eq('active', true)
      .order('campaign_type')
      .order('step_number')

    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ message: 'No active campaigns' }))
    }

    // Get all phone leads
    const { data: leads } = await supabase
      .from('phone_leads')
      .select('*')

    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ message: 'No leads to process' }))
    }

    // Get all sent messages to know what's already been sent
    const { data: sentLogs } = await supabase
      .from('sms_log')
      .select('phone_lead_id, campaign_id, status')
      .in('status', ['sent', 'pending', 'failed'])

    // Build a set of "leadId:campaignId" for quick lookup
    const sentSet = new Set(
      (sentLogs || []).map((log: any) => `${log.phone_lead_id}:${log.campaign_id}`)
    )

    const now = Date.now()
    let sent = 0
    let skipped = 0

    for (const lead of leads) {
      // Determine which campaign flow to use
      const campaignType = lead.converted ? 'converter' : 'non_converter'
      const leadCampaigns = campaigns.filter((c: any) => c.campaign_type === campaignType)

      // Use converted_at for converter flow timing, created_at for non-converter
      const baseTime = lead.converted && lead.converted_at
        ? new Date(lead.converted_at).getTime()
        : new Date(lead.created_at).getTime()

      for (const campaign of leadCampaigns) {
        const key = `${lead.id}:${campaign.id}`

        // Skip if already sent
        if (sentSet.has(key)) {
          skipped++
          continue
        }

        // Check if enough time has passed (delay_hours from base time)
        const sendAfter = baseTime + (campaign.delay_hours * 60 * 60 * 1000)
        if (now < sendAfter) {
          continue // Not time yet
        }

        // Send the SMS
        const twilioSid = await sendTwilioSMS(lead.phone, campaign.message_template)

        // Log it
        await supabase.from('sms_log').insert({
          phone_lead_id: lead.id,
          campaign_id: campaign.id,
          phone: lead.phone,
          message_body: campaign.message_template,
          status: twilioSid ? 'sent' : 'failed',
          twilio_sid: twilioSid,
          sent_at: new Date().toISOString(),
        })

        sent++
        sentSet.add(key) // Prevent double-sending in same run
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent, skipped, leads: leads.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('process-sms-queue error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
