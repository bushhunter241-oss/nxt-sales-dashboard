import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const shop = searchParams.get("shop");

  console.log("[Shopify Callback] code:", code ? `${code.slice(0, 10)}...` : "MISSING");
  console.log("[Shopify Callback] state:", state || "MISSING");
  console.log("[Shopify Callback] shop:", shop || "MISSING");
  console.log("[Shopify Callback] all params:", Object.fromEntries(searchParams.entries()));

  if (!code) {
    console.log("[Shopify Callback] ERROR: no code param");
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=missing_code", request.url));
  }

  // state検証
  const savedState = request.cookies.get("shopify_oauth_state")?.value;
  console.log("[Shopify Callback] savedState cookie:", savedState || "NOT FOUND");
  console.log("[Shopify Callback] state match:", state === savedState);

  if (!savedState || state !== savedState) {
    console.log("[Shopify Callback] ERROR: state mismatch — rejecting callback (CSRF protection)");
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=invalid_state", request.url));
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;

  console.log("[Shopify Callback] clientId:", clientId ? "SET" : "NOT SET");
  console.log("[Shopify Callback] clientSecret:", clientSecret ? "SET" : "NOT SET");
  console.log("[Shopify Callback] storeDomain:", storeDomain);

  if (!clientId || !clientSecret || !storeDomain) {
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=missing_env", request.url));
  }

  try {
    // トークン交換
    const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
    // form-urlencoded形式で送信（Shopify推奨）
    const formBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });
    console.log("[Shopify Callback] Token exchange URL:", tokenUrl);
    console.log("[Shopify Callback] code:", code.slice(0, 20) + "...");
    console.log("[Shopify Callback] client_id:", clientId);
    console.log("[Shopify Callback] client_secret length:", clientSecret.length);

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });

    const tokenStatus = tokenRes.status;
    const tokenText = await tokenRes.text();
    console.log("[Shopify Callback] Token response status:", tokenStatus);
    // セキュリティ上、tokenTextの本文（access_tokenを含む）はログに出さない

    if (!tokenRes.ok) {
      console.log("[Shopify Callback] ERROR: token exchange failed with status", tokenStatus);
      return NextResponse.redirect(new URL(`/settings/api-integration?shopify_error=token_${tokenStatus}`, request.url));
    }

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      console.log("[Shopify Callback] ERROR: failed to parse token response as JSON");
      return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=invalid_json", request.url));
    }

    const accessToken = tokenData.access_token;
    console.log("[Shopify Callback] access_token:", accessToken ? "RECEIVED" : "MISSING");
    console.log("[Shopify Callback] scope:", tokenData.scope);

    if (!accessToken) {
      return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=no_token", request.url));
    }

    // DB保存
    const db = createClient(supabaseUrl, supabaseAnonKey);
    console.log("[Shopify Callback] Saving to api_credentials...");

    const { data: dbData, error: dbError } = await db.from("api_credentials").upsert({
      credential_type: "shopify",
      client_id: clientId,
      client_secret: "",
      refresh_token: "",
      access_token: accessToken,
      is_active: true,
      profile_id: storeDomain,
    }, { onConflict: "credential_type" }).select();

    console.log("[Shopify Callback] DB result:", dbData ? "saved" : "null");
    console.log("[Shopify Callback] DB error:", dbError?.message || "none");

    if (dbError) {
      return NextResponse.redirect(new URL(`/settings/api-integration?shopify_error=db_${encodeURIComponent(dbError.message)}`, request.url));
    }

    // 成功
    console.log("[Shopify Callback] SUCCESS - redirecting to settings");
    const response = NextResponse.redirect(new URL("/settings/api-integration?shopify_success=true", request.url));
    response.cookies.delete("shopify_oauth_state");
    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.log("[Shopify Callback] EXCEPTION:", msg);
    return NextResponse.redirect(new URL(`/settings/api-integration?shopify_error=${encodeURIComponent(msg)}`, request.url));
  }
}
