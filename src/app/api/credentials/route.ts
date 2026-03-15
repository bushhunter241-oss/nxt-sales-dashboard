import { NextRequest, NextResponse } from "next/server";
import {
  getCredentials,
  saveCredentials,
  deleteCredentials,
  testConnection,
} from "@/lib/amazon/auth";

// GET: Check credential status (don't return actual secrets)
export async function GET() {
  try {
    const spApi = await getCredentials("sp-api");
    const adsApi = await getCredentials("ads-api");

    return NextResponse.json({
      "sp-api": spApi
        ? {
            configured: true,
            hasAccessToken: !!spApi.access_token,
            tokenExpiresAt: spApi.token_expires_at || null,
            updatedAt: spApi.updated_at,
          }
        : { configured: false, hasAccessToken: false, tokenExpiresAt: null, updatedAt: null },
      "ads-api": adsApi
        ? {
            configured: true,
            hasAccessToken: !!adsApi.access_token,
            tokenExpiresAt: adsApi.token_expires_at || null,
            profileId: adsApi.profile_id,
            updatedAt: adsApi.updated_at,
          }
        : { configured: false, hasAccessToken: false, tokenExpiresAt: null, updatedAt: null },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST: Save credentials and optionally test connection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credentialType, credentials, testConnection: doTest, testOnly } = body;

    // Test-only mode (no save)
    if (testOnly && credentialType) {
      const connectionTest = await testConnection(credentialType);
      return NextResponse.json({ connectionTest });
    }

    if (!credentialType || !credentials?.client_id || !credentials?.client_secret || !credentials?.refresh_token) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Save credentials
    const saveResult = await saveCredentials(credentialType, {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      profile_id: credentials.profile_id,
    });

    if (!saveResult.success) {
      return NextResponse.json(
        { error: saveResult.error },
        { status: 500 }
      );
    }

    // Optionally test connection
    let connectionTest = null;
    if (doTest) {
      connectionTest = await testConnection(credentialType);
    }

    return NextResponse.json({
      success: true,
      connectionTest,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE: Remove credentials
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const credentialType = searchParams.get("type") as
      | "sp-api"
      | "ads-api"
      | null;

    if (!credentialType) {
      return NextResponse.json(
        { error: "Missing credential type" },
        { status: 400 }
      );
    }

    const result = await deleteCredentials(credentialType);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
