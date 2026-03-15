import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const nextPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const nextPublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Try a raw fetch to Supabase to test connectivity
  let fetchTest = "not attempted";
  const urlToTest = supabaseUrl || nextPublicUrl || "https://placeholder.supabase.co";
  try {
    const res = await fetch(`${urlToTest}/rest/v1/`, {
      headers: { apikey: anonKey || nextPublicKey || "placeholder" },
    });
    fetchTest = `HTTP ${res.status}`;
  } catch (e) {
    fetchTest = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    SUPABASE_URL: supabaseUrl ? supabaseUrl.substring(0, 50) : "(undefined)",
    NEXT_PUBLIC_SUPABASE_URL: nextPublicUrl ? nextPublicUrl.substring(0, 50) : "(undefined)",
    SUPABASE_ANON_KEY: anonKey ? anonKey.substring(0, 20) + "..." : "(undefined)",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: nextPublicKey ? nextPublicKey.substring(0, 20) + "..." : "(undefined)",
    NODE_ENV: process.env.NODE_ENV,
    fetchTest,
    urlUsed: urlToTest.substring(0, 50),
  });
}
