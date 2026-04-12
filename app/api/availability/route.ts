import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const arrival = searchParams.get('arrival')
  const departure = searchParams.get('departure')
  const siteType = searchParams.get('siteType')

  if (!arrival || !departure) {
    return NextResponse.json({ error: 'Missing dates' }, { status: 400 })
  }

  // Get settings including season dates
  const { data: settings } = await supabase
    .from('settings')
    .select('season_start, season_end, closed_season_message')
    .limit(1)
    .single()

  // Check if dates are within season
  if (settings?.season_start && settings?.season_end) {
    const arrivalDate = new Date(arrival)
    const year = arrivalDate.getFullYear()

    const seasonStart = new Date(`${settings.season_start} ${year}`)
    const seasonEnd = new Date(`${settings.season_end} ${year}`)

    if (arrivalDate < seasonStart || arrivalDate > seasonEnd) {
      return NextResponse.json({
        sites: [],
        closed: true,
        closedMessage: settings.closed_season_message || 'We are closed for the season. We look forward to seeing you next year!',
        seasonStart: settings.season_start,
        seasonEnd: settings.season_end,
      })
    }
  }

  // Get all available sites
  let query = supabase
    .from('sites')
    .select('*')
    .eq('is_available', true)
    .order('display_order')

  if (siteType && siteType !== 'all') {
    query = query.eq('site_type', siteType)
  }

  const { data: sites, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get reservations that overlap with requested dates
  const { data: reservations } = await supabase
    .from('reservations')
    .select('site_id')
    .neq('status', 'cancelled')
    .lt('arrival_date', departure)
    .gt('departure_date', arrival)

  // Get blocked dates in range
  const { data: blockedDates } = await supabase
    .from('blocked_dates')
    .select('site_id, date')
    .gte('date', arrival)
    .lt('date', departure)

  const bookedSiteIds = new Set(reservations?.map(r => r.site_id) || [])
  const blockedAllSites = blockedDates?.some(b => !b.site_id) || false
  const blockedSpecificSiteIds = new Set(
    blockedDates?.filter(b => b.site_id).map(b => b.site_id) || []
  )

  const availableSites = sites?.filter(site => {
    if (bookedSiteIds.has(site.id)) return false
    if (blockedAllSites) return false
    if (blockedSpecificSiteIds.has(site.id)) return false
    return true
  }) || []

  // Get pricing rules
  const { data: pricingRules } = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('is_active', true)
    .lte('start_date', departure)
    .gte('end_date', arrival)

  // Get min stay rules
  const { data: minStayRules } = await supabase
    .from('min_stay_rules')
    .select('*')
    .eq('is_active', true)
    .lte('start_date', departure)
    .gte('end_date', arrival)

  const nights = Math.round(
    (new Date(departure).getTime() - new Date(arrival).getTime()) / (1000 * 60 * 60 * 24)
  )

  const sitesWithPricing = availableSites.map(site => {
    const applicableRules = pricingRules?.filter(rule => {
      if (rule.site_id) return rule.site_id === site.id
      if (rule.site_type) return rule.site_type === site.site_type
      return false
    }) || []

    const bestRule = applicableRules.sort((a, b) => b.priority - a.priority)[0]
    const nightlyRate = bestRule ? bestRule.nightly_rate : site.base_rate

    const applicableMinStay = minStayRules?.filter(rule => {
      if (rule.site_id) return rule.site_id === site.id
      if (rule.site_type) return rule.site_type === site.site_type
      return false
    }) || []

    const minStay = applicableMinStay.length > 0
      ? Math.max(...applicableMinStay.map(r => r.min_nights))
      : 1

    return {
      ...site,
      nightly_rate: nightlyRate,
      total_price: nightlyRate * nights,
      nights,
      min_stay: minStay,
      meets_min_stay: nights >= minStay,
    }
  })

  return NextResponse.json({ sites: sitesWithPricing, closed: false })
}