/**
 * Meta Marketing API v25.0 client
 */

const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

function getConfig() {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accountId || !accessToken) {
    throw new Error("META_AD_ACCOUNT_ID / META_ACCESS_TOKEN が未設定です");
  }
  return { accountId, accessToken };
}

export interface MetaInsight {
  date_start: string;
  date_stop: string;
  campaign_name: string;
  adset_name: string;
  ad_name: string;
  impressions: string;
  clicks: string;
  spend: string;
  cpc: string;
  ctr: string;
  cpm: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/**
 * Fetch ad insights for a date range.
 * level: "campaign" でキャンペーン単位の正確な消化金額を取得する。
 * （level: "ad" だと一部の広告費が欠落するケースがあるため）
 */
export async function fetchInsights(dateFrom: string, dateTo: string): Promise<MetaInsight[]> {
  const { accountId, accessToken } = getConfig();

  const fields = "campaign_name,impressions,clicks,spend,cpc,ctr,cpm,actions";
  const params = new URLSearchParams({
    access_token: accessToken,
    fields,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: "1", // 日別
    level: "campaign",
    limit: "500",
  });

  const allData: MetaInsight[] = [];
  let url = `${BASE_URL}/${accountId}/insights?${params}`;

  while (url) {
    const res = await fetch(url);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meta API error (${res.status}): ${errText}`);
    }

    const json = await res.json();
    allData.push(...(json.data || []));

    // ページネーション
    url = json.paging?.next || "";
  }

  return allData;
}

/**
 * Test connection by fetching account info
 */
export async function testConnection(): Promise<{ success: boolean; accountName?: string; error?: string }> {
  try {
    const { accountId, accessToken } = getConfig();
    const res = await fetch(`${BASE_URL}/${accountId}?fields=name,currency,timezone_name&access_token=${accessToken}`);
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error (${res.status}): ${errText.slice(0, 200)}` };
    }
    const data = await res.json();
    return { success: true, accountName: `${data.name} (${data.currency})` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
