import { NextResponse } from "next/server";
import { getProfiles } from "@/lib/amazon/ads-api";
import { getCredentials } from "@/lib/amazon/auth";

// GET: Fetch available Ads API profiles
export async function GET() {
  try {
    // Check if ads-api credentials exist
    const creds = await getCredentials("ads-api");
    if (!creds) {
      return NextResponse.json(
        { error: "Ads API認証情報が設定されていません。先にClient ID、Client Secret、Refresh Tokenを保存してください。" },
        { status: 400 }
      );
    }

    const profiles = await getProfiles();

    // Filter for JP marketplace profiles
    const jpProfiles = profiles.filter(
      (p) => p.countryCode === "JP" || p.accountInfo?.marketplaceStringId === "A1VC38T7YXB528"
    );

    return NextResponse.json({
      profiles: profiles.map((p) => ({
        profileId: String(p.profileId),
        countryCode: p.countryCode,
        currencyCode: p.currencyCode,
        timezone: p.timezone,
        accountName: p.accountInfo?.name || "Unknown",
        accountType: p.accountInfo?.type || "Unknown",
        marketplaceId: p.accountInfo?.marketplaceStringId || "",
        isJapan: p.countryCode === "JP",
      })),
      jpProfiles: jpProfiles.map((p) => ({
        profileId: String(p.profileId),
        accountName: p.accountInfo?.name || "Unknown",
        accountType: p.accountInfo?.type || "Unknown",
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "プロファイルの取得に失敗しました" },
      { status: 500 }
    );
  }
}
