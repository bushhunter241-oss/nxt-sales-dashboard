import { NextResponse } from "next/server";
import { refreshAccessToken, getCredentials } from "@/lib/amazon/auth";
import { AMAZON_CONFIG } from "@/lib/amazon/config";

export async function GET() {
  try {
    // 1. Check credentials exist
    const creds = await getCredentials("sp-api");
    if (!creds) {
      return NextResponse.json({ error: "No SP-API credentials found" }, { status: 400 });
    }

    // 2. Refresh token
    const accessToken = await refreshAccessToken("sp-api");

    // 3. Call Marketplace Participations to verify seller identity
    const mpRes = await fetch(
      `${AMAZON_CONFIG.SP_API_ENDPOINT}/sellers/v1/marketplaceParticipations`,
      {
        headers: {
          "x-amz-access-token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    const mpData = await mpRes.text();

    // 4. Call Orders API with a wide date range
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      MarketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
      CreatedAfter: "2025-01-01T00:00:00Z",
      CreatedBefore: twoMinAgo,
    });

    const ordersRes = await fetch(
      `${AMAZON_CONFIG.SP_API_ENDPOINT}/orders/v0/orders?${params.toString()}`,
      {
        headers: {
          "x-amz-access-token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    const ordersData = await ordersRes.text();

    // 5. Also try without OrderStatuses filter
    const params2 = new URLSearchParams({
      MarketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
      CreatedAfter: "2025-01-01T00:00:00Z",
      CreatedBefore: twoMinAgo,
      OrderStatuses: "Shipped,Unshipped,PartiallyShipped,Pending,Canceled,Unfulfillable,InvoiceUnconfirmed,PendingAvailability",
    });

    const ordersRes2 = await fetch(
      `${AMAZON_CONFIG.SP_API_ENDPOINT}/orders/v0/orders?${params2.toString()}`,
      {
        headers: {
          "x-amz-access-token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    const ordersData2 = await ordersRes2.text();

    return NextResponse.json({
      marketplace_participations: {
        status: mpRes.status,
        data: JSON.parse(mpData),
      },
      orders_no_status_filter: {
        status: ordersRes.status,
        data: JSON.parse(ordersData),
      },
      orders_all_statuses: {
        status: ordersRes2.status,
        data: JSON.parse(ordersData2),
      },
      config: {
        marketplace_id: AMAZON_CONFIG.MARKETPLACE_ID,
        endpoint: AMAZON_CONFIG.SP_API_ENDPOINT,
        created_before: twoMinAgo,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
