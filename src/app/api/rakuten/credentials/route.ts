import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/rakuten/credentials
 * 楽天API認証情報のステータスを取得
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({
        configured: false,
        serviceSecret: "",
        licenseKey: "",
      });
    }

    return NextResponse.json({
      configured: true,
      // マスク表示用
      serviceSecret: data.service_secret
        ? `${data.service_secret.substring(0, 4)}${"*".repeat(20)}`
        : "",
      licenseKey: data.license_key
        ? `${data.license_key.substring(0, 4)}${"*".repeat(20)}`
        : "",
      updatedAt: data.updated_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "取得失敗" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rakuten/credentials
 * 楽天API認証情報を保存
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { serviceSecret, licenseKey } = body;

    if (!serviceSecret || !licenseKey) {
      return NextResponse.json(
        { error: "serviceSecret と licenseKey は必須です" },
        { status: 400 }
      );
    }

    // upsert: 既存があれば更新、なければ作成
    const { error } = await supabase
      .from("rakuten_api_credentials")
      .upsert({
        id: "default",
        service_secret: serviceSecret,
        license_key: licenseKey,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "id",
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "保存しました" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失敗" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rakuten/credentials
 * 楽天API認証情報を削除
 */
export async function DELETE() {
  try {
    const { error } = await supabase
      .from("rakuten_api_credentials")
      .delete()
      .eq("id", "default");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "削除しました" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "削除失敗" },
      { status: 500 }
    );
  }
}
