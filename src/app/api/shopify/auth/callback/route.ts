import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * GET /api/shopify/auth/callback
 * Shopify OAuthコールバック: 認可コード → アクセストークン交換 → DB保存
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const shop = searchParams.get("shop");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=missing_params", request.url));
  }

  // state検証
  const savedState = request.cookies.get("shopify_oauth_state")?.value;
  if (state !== savedState) {
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=invalid_state", request.url));
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !clientSecret || !storeDomain) {
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=missing_env", request.url));
  }

  try {
    // 認可コード → アクセストークン交換
    const tokenRes = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Shopify token exchange failed:", errText);
      return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=token_exchange_failed", request.url));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=no_access_token", request.url));
    }

    // DBに保存
    const db = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await db.from("api_credentials").upsert({
      credential_type: "shopify",
      client_id: clientId,
      client_secret: "", // セキュリティのためDB保存しない
      refresh_token: "", // OAuthオフラインアクセストークンは期限なし
      access_token: accessToken,
      is_active: true,
      profile_id: storeDomain,
    }, { onConflict: "credential_type" });

    if (error) {
      console.error("Failed to save Shopify token:", error);
      return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=db_save_failed", request.url));
    }

    // 成功 → 設定ページにリダイレクト
    const response = NextResponse.redirect(new URL("/settings/api-integration?shopify_success=true", request.url));
    response.cookies.delete("shopify_oauth_state");
    return response;
  } catch (error) {
    console.error("Shopify OAuth error:", error);
    return NextResponse.redirect(new URL("/settings/api-integration?shopify_error=unknown", request.url));
  }
}
