import { NextResponse } from "next/server";
import { getCredentials } from "@/lib/amazon/auth";

// GET: Copy SP-API credentials for use with Ads API
export async function GET() {
  try {
    const spApi = await getCredentials("sp-api");
    if (!spApi) {
      return NextResponse.json(
        { error: "SP-API credentials not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      client_id: spApi.client_id,
      client_secret: spApi.client_secret,
      refresh_token: spApi.refresh_token,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
