import { NextRequest, NextResponse } from "next/server";
import { getCredentials, refreshAccessToken } from "@/lib/amazon/auth";
import { AMAZON_CONFIG } from "@/lib/amazon/config";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const reportId = searchParams.get("reportId");

  if (!reportId) {
    return NextResponse.json({ error: "reportId required" }, { status: 400 });
  }

  try {
    const accessToken = await refreshAccessToken("ads-api");
    const creds = await getCredentials("ads-api");

    const url = `${AMAZON_CONFIG.ADS_API_ENDPOINT}/reporting/reports/${reportId}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Amazon-Advertising-API-ClientId": creds?.client_id || "",
    };
    if (creds?.profile_id) {
      headers["Amazon-Advertising-API-Scope"] = creds.profile_id;
    }

    const response = await fetch(url, { headers });
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    return NextResponse.json({
      httpStatus: response.status,
      reportId,
      body: parsed,
      tokenExpiry: creds?.token_expires_at,
      profileId: creds?.profile_id,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
