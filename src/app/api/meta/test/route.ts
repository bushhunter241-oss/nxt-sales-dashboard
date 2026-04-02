import { NextResponse } from "next/server";
import { testConnection } from "@/lib/meta/client";

export async function GET() {
  try {
    const result = await testConnection();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
}
