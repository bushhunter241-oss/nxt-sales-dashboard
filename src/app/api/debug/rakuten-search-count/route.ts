import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getEsaAuthHeader, RMS_API_BASE } from "@/lib/rakuten/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const startDate = url.searchParams.get("start") || "2026-01-01";
  const endDate = url.searchParams.get("end") || "2026-01-31";

  const { data: cred } = await supabase
    .from("rakuten_api_credentials")
    .select("*")
    .single();

  if (!cred) {
    return NextResponse.json({ error: "No credentials" }, { status: 400 });
  }

  const auth = getEsaAuthHeader({
    serviceSecret: cred.service_secret,
    licenseKey: cred.license_key,
  });

  const startDatetime = `${startDate}T00:00:00+0900`;
  const endDatetime = `${endDate}T23:59:59+0900`;

  // 全ステータス [100-900]
  const res = await fetch(`${RMS_API_BASE}/es/2.0/order/searchOrder/`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      dateType: 1,
      startDatetime,
      endDatetime,
      orderProgressList: [100, 200, 300, 400, 700, 800, 900],
      PaginationRequestModel: {
        requestRecordsAmount: 100,
        requestPage: 1,
      },
    }),
  });

  const data = await res.json();

  return NextResponse.json({
    dateType: 1,
    dateTypeLabel: "注文日",
    startDate,
    endDate,
    pagination: data.PaginationResponseModel,
    totalRecordsAmount: data.PaginationResponseModel?.totalRecordsAmount,
    totalPages: data.PaginationResponseModel?.totalPages,
    messages: data.MessageModelList,
    firstOrderNumbers: data.orderNumberList,
  });
}
