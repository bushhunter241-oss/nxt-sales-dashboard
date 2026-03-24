"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { KPICard } from "@/components/layout/kpi-card";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getAggregatedDailySales, getProductSalesSummary } from "@/lib/api/sales";
import { getAdSummary, getDailyAdvertising } from "@/lib/api/advertising";
import { getAggregatedRakutenDailySales, getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { getRakutenAdSummary } from "@/lib/api/rakuten-advertising";
import { getMonthlyGoals } from "@/lib/api/goals";
import { getInventory } from "@/lib/api/inventory";
import { getShopifyDailySummary, getMetaAdSummary } from "@/lib/api/shopify-sales";
import { ACOS_TARGETS, classifyCampaign, getGroupTarget } from "@/lib/constants/acos-targets";
import { DollarSign, ShoppingCart, Megaphone, AlertTriangle, TrendingUp, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import Link from "next/link";
import { AiInsights } from "@/components/ai/AiInsights";

export default function DashboardPage() {
  const [period, setPeriod] = useState("this_month");
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const dateRange = getDateRange(period);
  const lastMonthRange = getDateRange("last_month");

  // 今月情報
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthRange = getDateRange("this_month");

  // ── データ取得 ──
  const { data: dailySales = [] } = useQuery({ queryKey: ["aggregatedSales", dateRange], queryFn: () => getAggregatedDailySales(dateRange) });
  const { data: productSummary = [] } = useQuery({ queryKey: ["productSummary", dateRange], queryFn: () => getProductSalesSummary(dateRange) });
  const { data: adSummary = { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({ queryKey: ["adSummary", dateRange], queryFn: () => getAdSummary(dateRange) });
  const { data: rakutenDailySales = [] } = useQuery({ queryKey: ["aggregatedRakutenSales", dateRange], queryFn: () => getAggregatedRakutenDailySales(dateRange) });
  const { data: rakutenProductSummary = [] } = useQuery({ queryKey: ["rakutenProductSummary", dateRange], queryFn: () => getRakutenProductSalesSummary(dateRange) });
  const { data: rakutenAdSummary = { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({ queryKey: ["rakutenAdSummary", dateRange], queryFn: () => getRakutenAdSummary(dateRange) });

  // 前月
  const { data: lastMonthDailySales = [] } = useQuery({ queryKey: ["aggregatedSalesLM", lastMonthRange], queryFn: () => getAggregatedDailySales(lastMonthRange) });
  const { data: lastMonthProductSummary = [] } = useQuery({ queryKey: ["productSummaryLM", lastMonthRange], queryFn: () => getProductSalesSummary(lastMonthRange) });
  const { data: lastMonthAdSummary = { total_ad_spend: 0 } } = useQuery({ queryKey: ["adSummaryLM", lastMonthRange], queryFn: () => getAdSummary(lastMonthRange) });
  const { data: lastMonthRakutenDailySales = [] } = useQuery({ queryKey: ["aggregatedRakutenSalesLM", lastMonthRange], queryFn: () => getAggregatedRakutenDailySales(lastMonthRange) });
  const { data: lastMonthRakutenProductSummary = [] } = useQuery({ queryKey: ["rakutenProductSummaryLM", lastMonthRange], queryFn: () => getRakutenProductSalesSummary(lastMonthRange) });
  const { data: lastMonthRakutenAdSummary = { total_ad_spend: 0 } } = useQuery({ queryKey: ["rakutenAdSummaryLM", lastMonthRange], queryFn: () => getRakutenAdSummary(lastMonthRange) });

  // 目標・在庫・広告詳細
  const { data: monthlyGoals = [] } = useQuery({ queryKey: ["monthlyGoals", currentYearMonth], queryFn: () => getMonthlyGoals(currentYearMonth) });
  // Shopify
  const { data: shopifyDaily = [] } = useQuery({ queryKey: ["shopifyDaily", dateRange], queryFn: () => getShopifyDailySummary(dateRange) });
  const { data: metaAdSummary = { total_spend: 0 } } = useQuery({ queryKey: ["metaAdSummary", dateRange], queryFn: () => getMetaAdSummary(dateRange) });
  const { data: shopifyDailyLM = [] } = useQuery({ queryKey: ["shopifyDailyLM", lastMonthRange], queryFn: () => getShopifyDailySummary(lastMonthRange) });
  const { data: metaAdSummaryLM = { total_spend: 0 } } = useQuery({ queryKey: ["metaAdSummaryLM", lastMonthRange], queryFn: () => getMetaAdSummary(lastMonthRange) });

  const { data: inventory = [] } = useQuery({ queryKey: ["inventory"], queryFn: getInventory });
  const { data: adDetail = [] } = useQuery({ queryKey: ["adDetail7d"], queryFn: () => getDailyAdvertising({ startDate: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0] }) });

  // ── 集計 ──
  const amazonSales = (dailySales as any[]).reduce((s: number, d: any) => s + d.sales_amount, 0);
  const amazonOrders = (dailySales as any[]).reduce((s: number, d: any) => s + d.orders, 0);
  const amazonAdSpend = adSummary?.total_ad_spend || 0;
  const amazonProfit = (productSummary as any[]).reduce((s: number, p: any) => s + (p.net_profit || 0), 0);

  const rktSales = (rakutenDailySales as any[]).reduce((s: number, d: any) => s + d.sales_amount, 0);
  const rktOrders = (rakutenDailySales as any[]).reduce((s: number, d: any) => s + d.orders, 0);
  const rktAdSpend = rakutenAdSummary?.total_ad_spend || 0;
  const rktProfit = (rakutenProductSummary as any[]).reduce((s: number, p: any) => s + (p.net_profit || 0), 0);

  // Shopify
  const shopifySales = (shopifyDaily as any[]).reduce((s: number, d: any) => s + (d.net_sales || 0), 0);
  const shopifyOrders = (shopifyDaily as any[]).reduce((s: number, d: any) => s + (d.total_orders || 0), 0);
  const shopifyAdSpend = metaAdSummary?.total_spend || 0;
  const shopifyProfit = shopifySales - shopifyAdSpend; // 簡易計算（詳細は商品別で）

  const totalSales = amazonSales + rktSales + shopifySales;
  const totalOrders = amazonOrders + rktOrders + shopifyOrders;
  const totalAdSpend = amazonAdSpend + rktAdSpend + shopifyAdSpend;
  const totalProfit = amazonProfit + rktProfit + shopifyProfit;
  const totalProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  // 前月
  const lmShopifySales = (shopifyDailyLM as any[]).reduce((s: number, d: any) => s + (d.net_sales || 0), 0);
  const lmShopifyOrders = (shopifyDailyLM as any[]).reduce((s: number, d: any) => s + (d.total_orders || 0), 0);
  const lmShopifyAdSpend = metaAdSummaryLM?.total_spend || 0;
  const lmSales = (lastMonthDailySales as any[]).reduce((s: number, d: any) => s + d.sales_amount, 0) + (lastMonthRakutenDailySales as any[]).reduce((s: number, d: any) => s + d.sales_amount, 0) + lmShopifySales;
  const lmOrders = (lastMonthDailySales as any[]).reduce((s: number, d: any) => s + d.orders, 0) + (lastMonthRakutenDailySales as any[]).reduce((s: number, d: any) => s + d.orders, 0) + lmShopifyOrders;
  const lmAdSpend = (lastMonthAdSummary?.total_ad_spend || 0) + (lastMonthRakutenAdSummary?.total_ad_spend || 0) + lmShopifyAdSpend;
  const lmProfit = (lastMonthProductSummary as any[]).reduce((s: number, p: any) => s + (p.net_profit || 0), 0) + (lastMonthRakutenProductSummary as any[]).reduce((s: number, p: any) => s + (p.net_profit || 0), 0) + (lmShopifySales - lmShopifyAdSpend);
  const lmProfitRate = lmSales > 0 ? (lmProfit / lmSales) * 100 : 0;

  // ── スパークライン ──
  const sparklines = useMemo(() => {
    const dateMap: Record<string, { sales: number; orders: number; adSpend: number; profit: number }> = {};
    for (const d of dailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { sales: 0, orders: 0, adSpend: 0, profit: 0 };
      dateMap[d.date].sales += d.sales_amount;
      dateMap[d.date].orders += d.orders;
    }
    for (const d of rakutenDailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { sales: 0, orders: 0, adSpend: 0, profit: 0 };
      dateMap[d.date].sales += d.sales_amount;
      dateMap[d.date].orders += d.orders;
    }
    const last7 = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
    return {
      sales: last7.map(([, v]) => v.sales),
      orders: last7.map(([, v]) => v.orders),
      adSpend: last7.map(() => 0), // placeholder
      profit: last7.map(() => 0),
    };
  }, [dailySales, rakutenDailySales]);

  // ── 着地予想 ──
  const projection = useMemo(() => {
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = daysInMonth - dayOfMonth;
    const dateMap: Record<string, { sales: number; orders: number }> = {};
    for (const d of dailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { sales: 0, orders: 0 };
      dateMap[d.date].sales += d.sales_amount; dateMap[d.date].orders += d.orders;
    }
    for (const d of rakutenDailySales as any[]) {
      if (!dateMap[d.date]) dateMap[d.date] = { sales: 0, orders: 0 };
      dateMap[d.date].sales += d.sales_amount; dateMap[d.date].orders += d.orders;
    }
    const sorted = Object.keys(dateMap).sort().slice(-7);
    const n = sorted.length || 1;
    const avgSales = sorted.reduce((s, d) => s + dateMap[d].sales, 0) / n;
    const avgOrders = sorted.reduce((s, d) => s + dateMap[d].orders, 0) / n;
    const avgAd = dayOfMonth > 0 ? totalAdSpend / dayOfMonth : 0;
    const avgProfit = dayOfMonth > 0 ? totalProfit / dayOfMonth : 0;
    return {
      sales: Math.round(totalSales + avgSales * remainingDays),
      orders: Math.round(totalOrders + avgOrders * remainingDays),
      adSpend: Math.round(totalAdSpend + avgAd * remainingDays),
      profit: Math.round(totalProfit + avgProfit * remainingDays),
      dayOfMonth, daysInMonth, remainingDays,
    };
  }, [dailySales, rakutenDailySales, totalSales, totalOrders, totalAdSpend, totalProfit]);
  const projProfitRate = projection.sales > 0 ? (projection.profit / projection.sales) * 100 : 0;

  // ── グループ集計 ──
  const groupRanking = useMemo(() => {
    const empty = () => ({ total_sales: 0, total_orders: 0, total_ad_spend: 0, net_profit: 0 });
    const groups: Record<string, { group: string; amazon: ReturnType<typeof empty>; rakuten: ReturnType<typeof empty>; shopify: ReturnType<typeof empty>; total_sales: number; total_orders: number; total_ad_spend: number; net_profit: number }> = {};
    const ensure = (g: string) => { if (!groups[g]) groups[g] = { group: g, amazon: empty(), rakuten: empty(), shopify: empty(), total_sales: 0, total_orders: 0, total_ad_spend: 0, net_profit: 0 }; };
    for (const p of productSummary as any[]) {
      const g = p.product?.product_group || "その他"; ensure(g);
      groups[g].amazon.total_sales += p.total_sales || 0; groups[g].amazon.total_orders += p.total_orders || 0;
      groups[g].amazon.total_ad_spend += p.total_ad_spend || 0; groups[g].amazon.net_profit += p.net_profit || 0;
      groups[g].total_sales += p.total_sales || 0; groups[g].total_orders += p.total_orders || 0;
      groups[g].total_ad_spend += p.total_ad_spend || 0; groups[g].net_profit += p.net_profit || 0;
    }
    for (const p of rakutenProductSummary as any[]) {
      const g = p.product?.product_group || "その他"; ensure(g);
      groups[g].rakuten.total_sales += p.total_sales || 0; groups[g].rakuten.total_orders += p.total_orders || 0;
      groups[g].rakuten.total_ad_spend += p.total_ad_spend || 0; groups[g].rakuten.net_profit += p.net_profit || 0;
      groups[g].total_sales += p.total_sales || 0; groups[g].total_orders += p.total_orders || 0;
      groups[g].total_ad_spend += p.total_ad_spend || 0; groups[g].net_profit += p.net_profit || 0;
    }
    // Shopify売上をfeelaグループに加算（Shopify=feela.専用）
    if (shopifySales > 0) {
      const g = "feela"; ensure(g);
      groups[g].shopify.total_sales += shopifySales;
      groups[g].shopify.total_orders += shopifyOrders;
      groups[g].shopify.total_ad_spend += shopifyAdSpend;
      groups[g].shopify.net_profit += shopifyProfit;
      groups[g].total_sales += shopifySales; groups[g].total_orders += shopifyOrders;
      groups[g].total_ad_spend += shopifyAdSpend; groups[g].net_profit += shopifyProfit;
    }
    return Object.values(groups).sort((a, b) => b.total_sales - a.total_sales);
  }, [productSummary, rakutenProductSummary, shopifySales, shopifyOrders, shopifyAdSpend, shopifyProfit]);

  // ── 目標ゲージ ──
  const goalGaugeData = useMemo(() => {
    const goals = monthlyGoals as any[];
    // グループ別の今月売上を計算
    const thisMonthGroupSales: Record<string, number> = {};
    for (const p of productSummary as any[]) {
      const g = p.product?.product_group || "その他";
      thisMonthGroupSales[g] = (thisMonthGroupSales[g] || 0) + (p.total_sales || 0);
    }
    for (const p of rakutenProductSummary as any[]) {
      const g = p.product?.product_group || "その他";
      thisMonthGroupSales[g] = (thisMonthGroupSales[g] || 0) + (p.total_sales || 0);
    }
    // Shopify売上をfeelaに加算
    if (shopifySales > 0) {
      thisMonthGroupSales["feela"] = (thisMonthGroupSales["feela"] || 0) + shopifySales;
    }

    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // channel='total'（または未設定=旧データ）の目標のみ対象
    const totalGoals = goals.filter((g: any) =>
      g.product_group && !g.product_id && (!g.channel || g.channel === "total")
    );

    // 目標があるグループ
    const result = totalGoals.map((g: any) => {
      const currentSales = thisMonthGroupSales[g.product_group] || 0;
      const projected = dayOfMonth > 0 ? Math.round(currentSales / dayOfMonth * daysInMonth) : 0;
      const pct = g.target_sales > 0 ? (projected / g.target_sales) * 100 : 0;
      return { group: g.product_group, target: g.target_sales, currentSales, projected, pct, hasGoal: true };
    });

    // 売上があるが目標未設定のグループを追加
    const goalGroups = new Set(totalGoals.map((g: any) => g.product_group));
    for (const [group, sales] of Object.entries(thisMonthGroupSales)) {
      if (!goalGroups.has(group) && sales > 0) {
        const projected = dayOfMonth > 0 ? Math.round(sales / dayOfMonth * daysInMonth) : 0;
        result.push({ group, target: 0, currentSales: sales, projected, pct: 0, hasGoal: false });
      }
    }

    return result.sort((a, b) => b.projected - a.projected);
  }, [monthlyGoals, productSummary, rakutenProductSummary]);

  // ── アラート ──
  const alerts = useMemo(() => {
    const result: Array<{ type: "inventory" | "acos" | "sales_change"; severity: "red" | "orange" | "yellow"; title: string; detail?: any; link?: string }> = [];

    // 在庫アラート
    const lowStock = (inventory as any[]).filter((inv: any) => inv.current_stock <= inv.reorder_point);
    for (const inv of lowStock) {
      result.push({
        type: "inventory", severity: "red",
        title: `${inv.product?.name || "不明"} の在庫が発注点以下です（残${inv.current_stock}個 / 発注点${inv.reorder_point}個）`,
        link: "/inventory",
      });
    }

    // ACOSアラート（グループ全体の直近7日加重平均）
    const adRows = adDetail as any[];
    const groupAdAgg: Record<string, { spend: number; sales: number; campaigns: Record<string, { spend: number; sales: number; name: string }> }> = {};
    for (const row of adRows) {
      const g = row.product?.product_group;
      if (!g) continue;
      if (!groupAdAgg[g]) groupAdAgg[g] = { spend: 0, sales: 0, campaigns: {} };
      groupAdAgg[g].spend += row.ad_spend || 0;
      groupAdAgg[g].sales += row.ad_sales || 0;
      const cType = classifyCampaign(row.campaign_name || "");
      if (!groupAdAgg[g].campaigns[cType]) groupAdAgg[g].campaigns[cType] = { spend: 0, sales: 0, name: cType };
      groupAdAgg[g].campaigns[cType].spend += row.ad_spend || 0;
      groupAdAgg[g].campaigns[cType].sales += row.ad_sales || 0;
    }

    for (const [gName, agg] of Object.entries(groupAdAgg)) {
      const groupAcos = agg.sales > 0 ? (agg.spend / agg.sales) * 100 : 0;
      const target = getGroupTarget(gName);
      if (groupAcos > target.groupThreshold) {
        const campaignDetails = Object.values(agg.campaigns).map(c => {
          const cAcos = c.sales > 0 ? (c.spend / c.sales) * 100 : 0;
          const cTarget = target.campaigns[c.name] || target.campaigns["_default"];
          let status: "green" | "orange" | "red" | "none" = "none";
          if (cTarget?.alertAt != null) {
            if (cAcos > cTarget.alertAt) status = "red";
            else if (cAcos > cTarget.alertAt * 0.9) status = "orange";
            else status = "green";
          }
          return { name: c.name, acos: cAcos, spend: c.spend, sales: c.sales, alertAt: cTarget?.alertAt, note: cTarget?.note, status };
        });
        result.push({
          type: "acos", severity: "orange",
          title: `${gName} の全体ACOSが閾値を超えています（${groupAcos.toFixed(1)}% / 閾値${target.groupThreshold}%）`,
          detail: { groupName: gName, groupAcos, campaigns: campaignDetails },
          link: "/advertising",
        });
      }
    }

    // 売上急変アラート
    const dailyMap: Record<string, Record<string, number>> = {};
    for (const d of dailySales as any[]) {
      for (const p of productSummary as any[]) {
        // simplified: use group totals from daily
      }
    }
    // グループ別日次データをgroupRankingから近似計算
    for (const g of groupRanking) {
      if (g.total_sales === 0) continue;
      // 直近14日のデータがないため、productSummary + lastMonthの比較で簡易判定
    }

    return result;
  }, [inventory, adDetail, groupRanking, dailySales, productSummary]);

  // ── チャート ──
  const mergedChartData = (() => {
    const dateMap: Record<string, { amazon: number; rakuten: number; shopify: number }> = {};
    for (const d of dailySales as any[]) { if (!dateMap[d.date]) dateMap[d.date] = { amazon: 0, rakuten: 0, shopify: 0 }; dateMap[d.date].amazon += d.sales_amount; }
    for (const d of rakutenDailySales as any[]) { if (!dateMap[d.date]) dateMap[d.date] = { amazon: 0, rakuten: 0, shopify: 0 }; dateMap[d.date].rakuten += d.sales_amount; }
    for (const d of shopifyDaily as any[]) { if (!dateMap[d.date]) dateMap[d.date] = { amazon: 0, rakuten: 0, shopify: 0 }; dateMap[d.date].shopify += d.net_sales || 0; }
    return Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date: date.slice(5), Amazon: v.amazon, 楽天: v.rakuten, Shopify: v.shopify }));
  })();

  const channelPieData = [
    { name: "Amazon", value: amazonSales, color: "#f97316" },
    { name: "楽天", value: rktSales, color: "#ef4444" },
    { name: "Shopify", value: shopifySales, color: "#22c55e" },
  ];

  const pctChange = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : 0;
  const fmtChange = (v: number, isPt = false) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}${isPt ? "pt" : "%"}`;

  const toggleAlert = (key: string) => setExpandedAlerts(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 5);

  return (
    <div>
      <PageHeader title="ダッシュボード" description="売上・利益の概要">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      {/* 1. アラート・通知エリア */}
      <div className="mb-6 space-y-2">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-green-900/20 p-3 text-sm text-green-400">
            <span>✅</span> 現在アラートはありません
          </div>
        ) : (
          <>
            {visibleAlerts.map((alert, i) => (
              <div key={i} className={`rounded-lg p-3 text-sm ${
                alert.severity === "red" ? "bg-red-900/20 text-red-400" :
                alert.severity === "orange" ? "bg-orange-900/20 text-orange-400" :
                "bg-yellow-900/20 text-yellow-400"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{alert.severity === "red" ? "🔴" : alert.severity === "orange" ? "🟠" : "🟡"}</span>
                    <span>{alert.title}</span>
                    {alert.type === "acos" && (
                      <button onClick={() => toggleAlert(`acos-${i}`)} className="ml-1 text-xs opacity-70 hover:opacity-100">
                        {expandedAlerts.has(`acos-${i}`) ? <ChevronDown className="inline h-3 w-3" /> : <ChevronRight className="inline h-3 w-3" />}
                        詳細
                      </button>
                    )}
                  </div>
                  {alert.link && (
                    <Link href={alert.link} className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100">
                      確認する <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                {/* ACOSドリルダウン */}
                {alert.type === "acos" && expandedAlerts.has(`acos-${i}`) && alert.detail && (
                  <div className="mt-2 ml-6 space-y-1 text-xs">
                    {alert.detail.campaigns.map((c: any, ci: number) => (
                      <div key={ci} className="flex items-center gap-2">
                        <span>{c.status === "red" ? "🔴" : c.status === "orange" ? "🟠" : c.status === "green" ? "🟢" : "—"}</span>
                        <span className="w-28">{c.name}</span>
                        <span>ACOS {c.acos.toFixed(1)}%</span>
                        {c.alertAt != null && <span className="text-[hsl(var(--muted-foreground))]">(閾値{c.alertAt}%)</span>}
                        {c.note && <span className="text-[hsl(var(--muted-foreground))] italic">{c.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {alerts.length > 5 && !showAllAlerts && (
              <button onClick={() => setShowAllAlerts(true)} className="text-xs text-[hsl(var(--muted-foreground))] hover:underline">
                他{alerts.length - 5}件を表示
              </button>
            )}
          </>
        )}
      </div>

      {/* 2. KPIカード（スパークライン付き） */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} sparklineData={sparklines.sales} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} sparklineData={sparklines.orders} />
        <KPICard title="広告費合計" value={formatCurrency(totalAdSpend)} icon={Megaphone} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={TrendingUp} />
        <KPICard title="利益率" value={formatPercent(totalProfitRate)} icon={TrendingUp}
          valueClassName={totalProfitRate >= 20 ? "text-green-400" : totalProfitRate >= 10 ? "text-yellow-400" : "text-red-400"} />
      </div>

      {/* 3. 着地予想テーブル */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>今月の着地予想</CardTitle>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {projection.dayOfMonth}/{projection.daysInMonth}日経過 ・ 残り{projection.remainingDays}日 ・ 直近7日平均ベース
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>指標</TableHead>
                <TableHead className="text-right">今月実績</TableHead>
                <TableHead className="text-right">着地予想</TableHead>
                <TableHead className="text-right">前月実績</TableHead>
                <TableHead className="text-right">前月比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { label: "売上", actual: totalSales, proj: projection.sales, prev: lmSales, fmt: formatCurrency },
                { label: "注文数", actual: totalOrders, proj: projection.orders, prev: lmOrders, fmt: formatNumber },
                { label: "広告費", actual: totalAdSpend, proj: projection.adSpend, prev: lmAdSpend, fmt: formatCurrency },
                { label: "利益", actual: totalProfit, proj: projection.profit, prev: lmProfit, fmt: formatCurrency },
              ].map(r => {
                const chg = pctChange(r.proj, r.prev);
                return (
                  <TableRow key={r.label}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{r.fmt(r.actual)}</TableCell>
                    <TableCell className="text-right font-bold text-[hsl(var(--primary))]">{r.fmt(r.proj)}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--muted-foreground))]">{r.fmt(r.prev)}</TableCell>
                    <TableCell className={`text-right font-medium ${chg >= 0 ? "text-green-500" : "text-red-500"}`}>{fmtChange(chg)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="font-medium">利益率</TableCell>
                <TableCell className="text-right">{formatPercent(totalProfitRate)}</TableCell>
                <TableCell className="text-right font-bold text-[hsl(var(--primary))]">{formatPercent(projProfitRate)}</TableCell>
                <TableCell className="text-right text-[hsl(var(--muted-foreground))]">{formatPercent(lmProfitRate)}</TableCell>
                <TableCell className={`text-right font-medium ${projProfitRate - lmProfitRate >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {fmtChange(projProfitRate - lmProfitRate, true)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 4. 目標 vs 着地予想ゲージ */}
      {goalGaugeData.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>目標 vs 着地予想</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {goalGaugeData.map((g, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{g.group}</span>
                    {g.hasGoal ? (
                      <span>
                        <span className={`font-bold ${g.pct >= 100 ? "text-green-500" : g.pct >= 80 ? "text-orange-400" : "text-red-500"}`}>
                          {g.pct.toFixed(1)}%
                        </span>
                        <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">
                          {formatCurrency(g.projected)} / {formatCurrency(g.target)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        着地予想 {formatCurrency(g.projected)}　<Link href="/goals" className="text-[hsl(var(--primary))] hover:underline">目標を設定 →</Link>
                      </span>
                    )}
                  </div>
                  <div className="h-3 w-full rounded-full bg-[hsl(var(--muted))] overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${g.pct >= 100 ? "bg-green-500" : g.pct >= 80 ? "bg-orange-400" : "bg-red-500"}`}
                      style={{ width: `${Math.min(120, g.pct)}%` }}
                    />
                    {/* 100%マーカー */}
                    <div className="absolute top-0 h-full w-0.5 bg-white/50" style={{ left: `${Math.min(100, 100 / Math.max(g.pct, 100) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AIインサイト */}
      <AiInsights />

      {/* 5. チャネル別サマリー */}
      <Card className="mt-6">
        <CardHeader><CardTitle>チャネル別サマリー</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>チャネル</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-orange-500" /><span className="font-medium">Amazon</span></div></TableCell>
                <TableCell className="text-right">{formatCurrency(amazonSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(amazonOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(amazonAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(amazonProfit)}</TableCell>
                <TableCell className="text-right">{amazonSales > 0 ? formatPercent((amazonProfit / amazonSales) * 100) : "0%"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-red-500" /><span className="font-medium">楽天</span></div></TableCell>
                <TableCell className="text-right">{formatCurrency(rktSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(rktOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(rktAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(rktProfit)}</TableCell>
                <TableCell className="text-right">{rktSales > 0 ? formatPercent((rktProfit / rktSales) * 100) : "0%"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-green-500" /><span className="font-medium">Shopify</span></div></TableCell>
                <TableCell className="text-right">{formatCurrency(shopifySales)}</TableCell>
                <TableCell className="text-right">{formatNumber(shopifyOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(shopifyAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(shopifyProfit)}</TableCell>
                <TableCell className="text-right">{shopifySales > 0 ? formatPercent((shopifyProfit / shopifySales) * 100) : "0%"}</TableCell>
              </TableRow>
              <TableRow className="border-t-2 font-bold">
                <TableCell>合計</TableCell>
                <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</TableCell>
                <TableCell className="text-right">{formatNumber(totalOrders)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalAdSpend)}</TableCell>
                <TableCell className="text-right">{formatCurrency(totalProfit)}</TableCell>
                <TableCell className="text-right">{formatPercent(totalProfitRate)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 6. チャート + ランキング */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>売上推移（Amazon + 楽天）</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mergedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} labelStyle={{ color: "hsl(0 0% 70%)" }} formatter={(value: any) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="Amazon" stackId="sales" fill="#f97316" radius={[0, 0, 0, 0]} />
                <Bar dataKey="楽天" stackId="sales" fill="#ef4444" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Shopify" stackId="sales" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>チャネル別売上比率</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={channelPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {channelPieData.map((entry, index) => (<Cell key={index} fill={entry.color} />))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {channelPieData.map((ch) => (
                  <div key={ch.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: ch.color }} /><span>{ch.name}</span></div>
                    <span className="font-medium">{formatCurrency(ch.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>商品グループランキング</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {groupRanking.slice(0, 5).map((g, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))]"}`}>{i + 1}</span>
                        <span className="text-sm font-medium">{g.group}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold">{formatCurrency(g.total_sales)}</span>
                        <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{formatNumber(g.total_orders)}件</span>
                      </div>
                    </div>
                    <div className="ml-9 mt-1 flex gap-3 text-[11px]">
                      <span className="text-orange-400">Amazon {formatCurrency(g.amazon.total_sales)}</span>
                      <span className="text-red-400">楽天 {formatCurrency(g.rakuten.total_sales)}</span>
                      {g.shopify.total_sales > 0 && <span className="text-green-400">Shopify {formatCurrency(g.shopify.total_sales)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
