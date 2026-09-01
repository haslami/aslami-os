/**
 * Matrix Mobile Details — Google Ads → Command Center
 *
 * WHERE THIS RUNS: inside Google Ads, not in this repo.
 *   Google Ads → Tools → Bulk actions → Scripts → + New script
 *   Paste this whole file, Authorize, Run once, then Schedule it Daily.
 *
 * WHY A SCRIPT INSTEAD OF THE API: the Google Ads API needs a developer token,
 * which needs a manager account and a review by Google. A script runs under the
 * account's own authorization with none of that, and can reach the network, so
 * it pushes straight into the same Supabase row the Command Center already reads.
 *
 * WHAT IT SENDS: campaign-level cost, clicks, impressions and conversions for the
 * last 30 days, plus a daily series. No customer data of any kind leaves Google.
 *
 * The key below is the PUBLISHABLE key — the same one already visible in the
 * Command Center's page source. It is safe here. Never paste a secret or
 * service-role key into a script.
 */

var SUPA_URL = 'https://llrmrekixkrtxuyqsbwb.supabase.co/rest/v1/matrix';
var SUPA_KEY = 'sb_publishable_jD7t0YZl64xkLAPYJOfOgQ_GBnROkJv';
var ROW_ID   = 'google_ads';
var DAYS     = 30;

function main() {
  var query =
    'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, ' +
    'metrics.conversions, metrics.conversions_value ' +
    'FROM campaign ' +
    'WHERE segments.date DURING LAST_30_DAYS';

  var byCampaign = {};
  var byDay = {};
  var totals = { cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };

  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    // cost_micros is a string of millionths — divide, don't trust it as a number.
    var cost = Number(r.metrics.costMicros || 0) / 1000000;
    var clicks = Number(r.metrics.clicks || 0);
    var impr = Number(r.metrics.impressions || 0);
    var conv = Number(r.metrics.conversions || 0);
    var cval = Number(r.metrics.conversionsValue || 0);
    var name = r.campaign.name;
    var day = r.segments.date;

    var c = byCampaign[name] || (byCampaign[name] = {
      campaign: name, status: r.campaign.status,
      channel: r.campaign.advertisingChannelType,
      cost: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0
    });
    c.cost += cost; c.clicks += clicks; c.impressions += impr;
    c.conversions += conv; c.convValue += cval;

    var d = byDay[day] || (byDay[day] = { date: day, cost: 0, clicks: 0, conversions: 0 });
    d.cost += cost; d.clicks += clicks; d.conversions += conv;

    totals.cost += cost; totals.clicks += clicks; totals.impressions += impr;
    totals.conversions += conv; totals.convValue += cval;
  }

  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var campaigns = [];
  for (var k in byCampaign) {
    var x = byCampaign[k];
    campaigns.push({
      campaign: x.campaign, status: x.status, channel: x.channel,
      cost: round2(x.cost), clicks: x.clicks, impressions: x.impressions,
      conversions: round2(x.conversions), convValue: round2(x.convValue),
      cpc: x.clicks ? round2(x.cost / x.clicks) : 0,
      costPerConv: x.conversions ? round2(x.cost / x.conversions) : 0
    });
  }
  campaigns.sort(function (a, b) { return b.cost - a.cost; });

  var daily = [];
  for (var dk in byDay) {
    daily.push({ date: byDay[dk].date, cost: round2(byDay[dk].cost),
                 clicks: byDay[dk].clicks, conversions: round2(byDay[dk].conversions) });
  }
  daily.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  var payload = {
    builtAt: new Date().getTime(),
    account: AdsApp.currentAccount().getCustomerId(),
    accountName: AdsApp.currentAccount().getName(),
    windowDays: DAYS,
    currency: AdsApp.currentAccount().getCurrencyCode(),
    totals: {
      cost: round2(totals.cost), clicks: totals.clicks, impressions: totals.impressions,
      conversions: round2(totals.conversions), convValue: round2(totals.convValue),
      cpc: totals.clicks ? round2(totals.cost / totals.clicks) : 0,
      costPerConv: totals.conversions ? round2(totals.cost / totals.conversions) : 0,
      ctr: totals.impressions ? round2((totals.clicks / totals.impressions) * 100) : 0
    },
    campaigns: campaigns,
    daily: daily
  };

  var res = UrlFetchApp.fetch(SUPA_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      // Upsert: rewrite the same row every run rather than piling up history.
      Prefer: 'resolution=merge-duplicates'
    },
    payload: JSON.stringify({
      id: ROW_ID,
      data: payload,
      updated_at: new Date().toISOString()
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('Sent ' + campaigns.length + ' campaigns, $' + payload.totals.cost +
               ' over ' + DAYS + ' days.');
  } else {
    // A silent failure here would look exactly like "no ad spend yet" on the
    // dashboard, so make it loud in the script log.
    Logger.log('PUSH FAILED ' + code + ': ' + res.getContentText());
    throw new Error('Could not push to the Command Center: HTTP ' + code);
  }
}
