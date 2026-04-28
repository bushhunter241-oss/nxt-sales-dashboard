import { NextResponse } from "next/server";

/**
 * GET /api/health
 * 認証不要のヘルスチェックエンドポイント。
 * 外部監視ツール（UptimeRobot等）からのアクセスを想定。
 * middleware.ts の Basic認証もこのパスは除外している。
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
