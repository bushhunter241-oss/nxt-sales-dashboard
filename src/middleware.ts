import { NextRequest, NextResponse } from "next/server";

/**
 * 全ページ・全APIルートにBasic認証をかける middleware。
 *
 * Vercel Hobbyプランでは Deployment Protection が使えないため、
 * アプリレイヤーで認証する。詳細は CLAUDE.md の「同期エンドポイントの認証強化」参照。
 *
 * 認証スキップ条件:
 * - 開発環境 (NODE_ENV=development)
 * - Vercel Cron からのリクエスト (Authorization: Bearer ${CRON_SECRET})
 * - 静的アセット・Next.js内部リソース (config.matcher で除外)
 * - ヘルスチェック (/api/health)
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 開発環境はスキップ
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  // 2. ヘルスチェックは認証なし（外部監視ツール想定）
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // 3. Vercel Cron は CRON_SECRET ヘッダーで認証スキップ
  // Vercel公式: cron jobs は Authorization: Bearer ${CRON_SECRET} を送信する。
  // CRON_SECRET が dashboard 全体への裏口にならないよう、cron ルート配下のみに制限する。
  const authHeader = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret
    && authHeader === `Bearer ${cronSecret}`
    && pathname.startsWith("/api/cron/")
  ) {
    return NextResponse.next();
  }

  // 4. Basic認証チェック
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;

  // 環境変数未設定はミスコンフィグとみなし、フェイルクローズで500を返す。
  // 本番環境で誤って未設定にすると全ページ無認証公開になるため、
  // 素通しではなく明示的にエラーで止める。
  if (!expectedUser || !expectedPass) {
    console.error(
      "[middleware] BASIC_AUTH_USER / BASIC_AUTH_PASSWORD が未設定です。Vercel環境変数を確認してください。"
    );
    return new NextResponse("Server misconfiguration: authentication credentials are not set.", {
      status: 500,
    });
  }

  // 5. Basic認証ヘッダーをパース
  if (authHeader.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length);
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      decoded = "";
    }
    const sepIdx = decoded.indexOf(":");
    if (sepIdx >= 0) {
      const user = decoded.slice(0, sepIdx);
      const pass = decoded.slice(sepIdx + 1);
      if (user === expectedUser && pass === expectedPass) {
        return NextResponse.next();
      }
    }
  }

  // 6. 認証失敗 → 401 + WWW-Authenticate ヘッダーで再要求
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="NXT Sales Dashboard", charset="UTF-8"',
    },
  });
}

export const config = {
  // 静的アセット・Next.js内部リソースは matcher で除外
  // - /_next/static/*  : Next.js静的ファイル
  // - /_next/image/*   : Next.js画像最適化
  // - /favicon.ico     : ファビコン
  // - /robots.txt, /sitemap.xml : SEO関連
  // - /public配下の各種ファイル : 画像・アイコン等
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.ico$|.*\\.webp$).*)",
  ],
};
