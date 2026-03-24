import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GET /api/shopify/auth
 * Shopify OAuth認可画面へリダイレクト
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !store) {
    return NextResponse.json({ error: "SHOPIFY_CLIENT_ID / SHOPIFY_STORE_DOMAIN が未設定です" }, { status: 500 });
  }

  // CSRF対策用のstate
  const state = crypto.randomBytes(16).toString("hex");

  // コールバックURL
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/shopify/auth/callback`;

  const scopes = "read_orders,read_products,read_analytics";

  const authUrl = `https://${store}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  // stateをcookieに保存（コールバックで検証）
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10分
    path: "/",
  });

  return response;
}
