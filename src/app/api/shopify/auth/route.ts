import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GET /api/shopify/auth
 * Shopify OAuth認可画面へリダイレクト
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  console.log("[Shopify Auth] clientId:", clientId ? `${clientId.slice(0, 8)}...` : "NOT SET");
  console.log("[Shopify Auth] store:", store || "NOT SET");

  if (!clientId || !store) {
    // 環境変数未設定の場合、エラーページにリダイレクト（JSONではなく）
    const errorUrl = new URL("/settings/api-integration", request.nextUrl.origin);
    errorUrl.searchParams.set("shopify_error", "env_not_set");
    return NextResponse.redirect(errorUrl);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/shopify/auth/callback`;
  const scopes = "read_orders,read_products,read_analytics";

  const authUrl = `https://${store}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  console.log("[Shopify Auth] Redirecting to:", authUrl);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
