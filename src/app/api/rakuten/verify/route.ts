import { NextResponse } from "next/server";
import { getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";

/**
 * GET /api/rakuten/verify?month=2026-01
 * Excelの正解データとNXTの計算結果を比較して差異レポートを返す。
 */

// Excelの正解データ（手動入力）
const EXCEL_DATA: Record<string, Record<string, {
  sales: number;
  cost: number;
  shipping: number;
  fee: number;
  ad_spend: number;
  net_profit: number;
  units: number;
}>> = {
  "2026-01": {
    feela01: { sales: 1084900, cost: 375100, shipping: 85184, fee: 108490, ad_spend: 49824, net_profit: 466302, units: 121 },
    imin01: { sales: 1069810, cost: 218559, shipping: 88101, fee: 106981, ad_spend: 512718, net_profit: 143451, units: 351 },
    imin02: { sales: 459600, cost: 118712, shipping: 95381, fee: 45960, ad_spend: 109323, net_profit: 90224, units: 245 },
    imin03: { sales: 475700, cost: 97653, shipping: 68222, fee: 47570, ad_spend: 50570, net_profit: 211685, units: 272 },
  },
  "2026-02": {
    feela01: { sales: 953750, cost: 310000, shipping: 70400, fee: 95375, ad_spend: 41565, net_profit: 436410, units: 100 },
    imin01: { sales: 727390, cost: 159619, shipping: 64306, fee: 72739, ad_spend: 398975, net_profit: 31751, units: 256 },
    imin02: { sales: 320380, cost: 75460, shipping: 60684, fee: 32038, ad_spend: 81060, net_profit: 71138, units: 156 },
    imin03: { sales: 318750, cost: 57624, shipping: 40260, fee: 31875, ad_spend: 24510, net_profit: 164481, units: 160 },
  },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || "2026-01";

  // 月の開始日・終了日
  const startDate = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  // NXTの計算結果を取得
  const nxtData = await getRakutenProductSalesSummary({ startDate, endDate });

  // Excelの正解データ
  const excelMonth = EXCEL_DATA[month];

  if (!excelMonth) {
    return NextResponse.json({
      error: `Excelデータが登録されていません: ${month}`,
      availableMonths: Object.keys(EXCEL_DATA),
    });
  }

  // 比較レポート作成
  const report = Object.entries(excelMonth).map(([productId, excel]) => {
    const nxt = nxtData.find((n: any) => n.product?.product_id === productId);

    if (!nxt) {
      return {
        product_id: productId,
        status: "MISSING",
        message: "NXTにデータなし",
        excel,
      };
    }

    const diff = {
      sales: (nxt.total_sales || 0) - excel.sales,
      cost: (nxt.total_cost || 0) - excel.cost,
      shipping: (nxt.total_shipping || 0) - excel.shipping,
      fee: (nxt.total_fee || 0) - excel.fee,
      ad_spend: (nxt.total_ad_spend || 0) - excel.ad_spend,
      net_profit: (nxt.net_profit || 0) - excel.net_profit,
      units: (nxt.total_units || 0) - excel.units,
    };

    const diffRate = excel.net_profit !== 0
      ? ((diff.net_profit / excel.net_profit) * 100).toFixed(1)
      : "N/A";

    return {
      product_id: productId,
      product_name: nxt.product?.name,
      status: Math.abs(Number(diffRate)) <= 5 ? "OK" : "MISMATCH",
      diff_rate: `${diffRate}%`,
      excel: {
        sales: excel.sales,
        cost: excel.cost,
        shipping: excel.shipping,
        fee: excel.fee,
        ad_spend: excel.ad_spend,
        net_profit: excel.net_profit,
        units: excel.units,
      },
      nxt: {
        sales: nxt.total_sales || 0,
        cost: nxt.total_cost || 0,
        shipping: nxt.total_shipping || 0,
        fee: nxt.total_fee || 0,
        ad_spend: nxt.total_ad_spend || 0,
        net_profit: nxt.net_profit || 0,
        units: nxt.total_units || 0,
      },
      diff,
    };
  });

  const allOk = report.every(r => r.status === "OK");

  return NextResponse.json({
    month,
    dateRange: { startDate, endDate },
    overall: allOk ? "PASS" : "FAIL",
    products: report,
  });
}
