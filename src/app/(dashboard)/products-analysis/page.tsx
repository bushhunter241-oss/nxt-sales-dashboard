"use client";
import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getProductSalesSummary, getDailySales, filterOutParentAsins } from "@/lib/api/sales";
import { getCampaignAdSpendByGroup } from "@/lib/api/advertising";
import { getProducts } from "@/lib/api/products";
import { getBsrRankings } from "@/lib/api/bsr";
import { getMonthlyGoals } from "@/lib/api/goals";
import { getProductEvents } from "@/lib/api/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, ReferenceLine, ReferenceArea } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

// Product group → color mapping (partial match)
const GROUP_COLOR_RULES: Array<{ match: string; color: string }> = [
  { match: "feela", color: "#22c55e" },
  { match: "Moon", color: "#eab308" },
  { match: "お香", color: "#f97316" },
  { match: "お得用", color: "#ec4899" },
  { match: "RHINON", color: "#3b82f6" },
  { match: "ホワイトセージ", color: "#6b7280" },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  sale: "セール", image_change: "画像変更", ad_campaign: "広告施策",
  price_change: "価格変更", listing_update: "出品更新", other: "その他",
};

function getGroupColor(name: string, fallbackIndex: number): string {
  for (const rule of GROUP_COLOR_RULES) {
    if (name.includes(rule.match)) return rule.color;
  }
  return CHART_COLORS[fallbackIndex % CHART_COLORS.length];
}

// Get group key: use DB product_group if set, otherwise fallback to name-based grouping
function getGroupKey(product: any): string {
  if (product?.product_group) return product.product_group;
  const name = product?.name || "";
  if (!name) return "未分類";
  let clean = name.replace(/^【[^】]*】\s*/g, "").trim();
  return clean.length > 25 ? clean.slice(0, 25) : clean;
}

interface GroupedProduct {
  groupKey: string;
  groupName: string;
  children: any[];
  total_sales: number;
  total_orders: number;
  total_units: number;
  total_cost: number;
  total_fba_fee: number;
  total_point_cost: number;
  total_ad_spend: number;
  total_sessions: number;
  gross_profit: number;
  net_profit: number;
  profit_rate: number;
  unit_profit: number;
}

function groupProducts(
  products: any[],
  campaignAdByGroup: Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }>
): GroupedProduct[] {
  const groups: Record<string, GroupedProduct> = {};
  for (const p of products) {
    const key = getGroupKey(p.product);
    if (!groups[key]) {
      groups[key] = {
        groupKey: key,
        groupName: key,
        children: [],
        total_sales: 0, total_orders: 0, total_units: 0,
        total_cost: 0, total_fba_fee: 0, total_point_cost: 0, total_ad_spend: 0, total_sessions: 0,
        gross_profit: 0, net_profit: 0, profit_rate: 0, unit_profit: 0,
      };
    }
    const g = groups[key];
    g.children.push(p);
    g.total_sales += p.total_sales || 0;
    g.total_orders += p.total_orders || 0;
    g.total_units += p.total_units || 0;
    g.total_cost += p.total_cost || 0;
    g.total_fba_fee += p.total_fba_fee || 0;
    g.total_point_cost += p.total_point_cost || 0;
    g.total_ad_spend += p.total_ad_spend || 0; // ASIN別合計（参考値）
    g.total_sessions += p.total_sessions || 0;
    g.gross_profit += p.gross_profit || 0;
  }
  // キャンペーン単位の広告費でグループ利益を計算（ASIN二重計上を回避）
  const hasCampaignData = Object.keys(campaignAdByGroup).length > 0;
  for (const g of Object.values(groups)) {
    const campaignAd = campaignAdByGroup[g.groupKey];
    if (hasCampaignData && campaignAd) {
      // キャンペーン広告費を使用（正確な値）
      g.total_ad_spend = campaignAd.ad_spend;
      g.net_profit = g.gross_profit - campaignAd.ad_spend;
    } else if (hasCampaignData) {
      // キャンペーンデータはあるがこのグループは広告なし
      g.net_profit = g.gross_profit;
      g.total_ad_spend = 0;
    } else {
      // フォールバック: ASIN別合計を使用（キャンペーンデータ未取得時）
      const totalExpenses = g.children.reduce((s: number, p: any) => s + (p.total_expenses || 0), 0);
      g.net_profit = g.gross_profit - g.total_ad_spend - totalExpenses;
    }
    // 経費はキャンペーンデータの有無にかかわらず減算
    if (hasCampaignData) {
      const totalExpenses = g.children.reduce((s: number, p: any) => s + (p.total_expenses || 0), 0);
      g.net_profit -= totalExpenses;
    }
    g.profit_rate = g.total_sales > 0 ? (g.net_profit / g.total_sales) * 100 : 0;
    g.unit_profit = g.total_units > 0 ? Math.round(g.net_profit / g.total_units) : 0;
  }
  return Object.values(groups);
}

export default function ProductAnalysisPage() {
  const [period, setPeriod] = useState("this_month");
  const [sortKey, setSortKey] = useState<string>("total_sales");
  const [viewMode, setViewMode] = useState<string>("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [metricsTab, setMetricsTab] = useState<string>("bsr");
  const [detailGroup, setDetailGroup] = useState("");
  const [detailPeriod, setDetailPeriod] = useState<"current" | "compare">("current");
  const dateRange = getDateRange(period);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["productSummary", dateRange],
    queryFn: () => getProductSalesSummary(dateRange),
  });

  const { data: allDailySales = [] } = useQuery({
    queryKey: ["allDailySales", dateRange],
    queryFn: () => getDailySales({ ...dateRange }),
  });

  // キャンペーン単位の広告費（ASIN二重計上回避）
  const { data: campaignAdByGroup = {} } = useQuery({
    queryKey: ["campaignAdByGroup", dateRange],
    queryFn: () => getCampaignAdSpendByGroup(dateRange),
  });

  // Current month info for goals/BEP
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthStart = `${currentYearMonth}-01`;
  const currentMonthEnd = now.toISOString().split("T")[0];
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  const { data: monthlyGoals = [] } = useQuery({
    queryKey: ["monthlyGoals", currentYearMonth],
    queryFn: () => getMonthlyGoals(currentYearMonth),
  });

  // Dedicated current month product summary for BEP (always full month, independent of period filter)
  const { data: currentMonthSummary = [] } = useQuery({
    queryKey: ["currentMonthSummary", currentMonthStart, currentMonthEnd],
    queryFn: () => getProductSalesSummary({ startDate: currentMonthStart, endDate: currentMonthEnd }),
  });

  // Last month date range for comparison
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastYearMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthStart = `${lastYearMonth}-01`;
  const lastMonthEnd = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0).toISOString().split("T")[0];

  const { data: lastMonthSales = [] } = useQuery({
    queryKey: ["lastMonthSales", lastMonthStart, lastMonthEnd],
    queryFn: () => getDailySales({ startDate: lastMonthStart, endDate: lastMonthEnd }),
  });

  // Product events for chart overlay
  const { data: productEvents = [] } = useQuery({
    queryKey: ["productEvents", dateRange],
    queryFn: () => getProductEvents({ startDate: dateRange.startDate, endDate: dateRange.endDate }),
  });

  const { data: bsrRankings = [] } = useQuery({
    queryKey: ["bsrRankings", dateRange],
    queryFn: () => getBsrRankings(dateRange.startDate, dateRange.endDate),
  });

  // BSR chart data - group by parent_asin (product group), show best rank over time
  const bsrChartData = useMemo(() => {
    if (!bsrRankings || bsrRankings.length === 0) return [];

    // Group by date + product_group (same product_group → same line)
    const dateMap: Record<string, Record<string, number[]>> = {};
    const groupLabels = new Map<string, string>(); // groupKey -> display label

    for (const r of bsrRankings as any[]) {
      const date = r.recorded_at?.split("T")[0] || "";
      // Group key: product_group if set, otherwise fall back to individual asin
      const groupKey = r.product?.product_group || r.product?.asin || r.asin;
      // Display label: same as groupKey (already human-readable)
      if (!groupLabels.has(groupKey)) {
        const label = groupKey;
        groupLabels.set(groupKey, label.length > 15 ? label.slice(0, 15) + "…" : label);
      }

      if (!dateMap[date]) dateMap[date] = {};
      if (!dateMap[date][groupKey]) dateMap[date][groupKey] = [];
      dateMap[date][groupKey].push(r.rank);
    }

    // Convert to chart data: use best (lowest) rank per group per date
    const groupKeys = Array.from(groupLabels.keys());
    const data = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groups]) => {
        const row: Record<string, any> = { date: date.slice(5) };
        for (const key of groupKeys) {
          if (groups[key]) {
            row[groupLabels.get(key)!] = Math.min(...groups[key]);
          }
        }
        return row;
      });

    return {
      data,
      products: groupKeys.map((k) => groupLabels.get(k)!),
    };
  }, [bsrRankings]);

  // Group-level daily metrics (sessions, CVR, sales, profit) aggregated by product_group + date
  const groupDailyMetrics = useMemo(() => {
    if (!allDailySales || allDailySales.length === 0) return { data: [] as any[], groups: [] as string[] };

    // Build product_id → group mapping
    const pidToGroup = new Map<string, string>();
    for (const p of products as any[]) {
      pidToGroup.set(p.id, p.product_group || p.name);
    }

    // Aggregate by date + group
    const dateGroupMap: Record<string, Record<string, { sessions: number; orders: number; units: number; sales: number }>> = {};
    const allGroups = new Set<string>();

    for (const d of allDailySales as any[]) {
      const group = pidToGroup.get(d.product_id);
      if (!group) continue;
      allGroups.add(group);
      const date = d.date;
      if (!dateGroupMap[date]) dateGroupMap[date] = {};
      if (!dateGroupMap[date][group]) dateGroupMap[date][group] = { sessions: 0, orders: 0, units: 0, sales: 0 };
      dateGroupMap[date][group].sessions += d.sessions || 0;
      dateGroupMap[date][group].orders += d.orders || 0;
      dateGroupMap[date][group].units += d.units_sold || 0;
      dateGroupMap[date][group].sales += d.sales_amount || 0;
    }

    // Also get cost/fee info per group from productSummary for profit calculation
    const groupProfitInfo: Record<string, { costPerUnit: number; fbaFeeRate: number; fbaShippingFee: number }> = {};
    for (const p of products as any[]) {
      const group = p.product_group || p.name;
      if (!groupProfitInfo[group]) {
        groupProfitInfo[group] = { costPerUnit: p.cost_price || 0, fbaFeeRate: p.fba_fee_rate || 15, fbaShippingFee: p.fba_shipping_fee || 0 };
      }
    }

    const groups = Array.from(allGroups);
    const shortLabels = new Map<string, string>();
    for (const g of groups) {
      shortLabels.set(g, g.length > 15 ? g.slice(0, 15) + "…" : g);
    }

    return { dateGroupMap, groups, shortLabels, groupProfitInfo };
  }, [allDailySales, products, productSummary]);

  // Build chart data for the selected metrics tab
  const metricsChartData = useMemo(() => {
    const { dateGroupMap, groups, shortLabels, groupProfitInfo } = groupDailyMetrics as any;
    if (!dateGroupMap || !groups || groups.length === 0) return { data: [], groups: [] };

    const data = Object.entries(dateGroupMap as Record<string, Record<string, any>>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groupData]) => {
        const row: Record<string, any> = { date: date.slice(5) };
        for (const g of groups) {
          const d = groupData[g];
          if (!d) continue;
          const label = shortLabels.get(g)!;
          if (metricsTab === "sessions") {
            row[label] = d.sessions;
          } else if (metricsTab === "cvr") {
            row[label] = d.sessions > 0 ? Math.round((d.orders / d.sessions) * 10000) / 100 : 0;
          } else if (metricsTab === "sales") {
            row[label] = d.sales;
          } else if (metricsTab === "profit") {
            const info = groupProfitInfo[g] || { costPerUnit: 0, fbaFeeRate: 15, fbaShippingFee: 0 };
            const cost = info.costPerUnit * d.units;
            const referral = Math.round(d.sales * (info.fbaFeeRate / 100));
            const shipping = info.fbaShippingFee * d.units;
            row[label] = d.sales - cost - referral - shipping;
          }
        }
        return row;
      });

    return { data, groups: groups.map((g: string) => shortLabels.get(g)!) };
  }, [groupDailyMetrics, metricsTab]);

  // Detail analysis data for a single selected group (all metrics in one dataset)
  // Build event lookup by date (MM-DD) for chart overlay
  const detailEventsByDate = useMemo(() => {
    if (!detailGroup) return new Map<string, any[]>();
    const map = new Map<string, any[]>();
    for (const ev of productEvents as any[]) {
      if (ev.product_group === detailGroup) {
        const key = ev.date.slice(5); // MM-DD
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
    }
    return map;
  }, [detailGroup, productEvents]);

  const detailChartData = useMemo(() => {
    const { dateGroupMap, groupProfitInfo } = groupDailyMetrics as any;
    if (!detailGroup || !dateGroupMap) return [];

    return Object.entries(dateGroupMap as Record<string, Record<string, any>>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, groupData]) => {
        const d = groupData[detailGroup];
        const dateKey = date.slice(5);
        const dayEvents = detailEventsByDate.get(dateKey) || [];
        if (!d) return { date: dateKey, fullDate: date, セッション: 0, CVR: 0, 売上: 0, 利益: 0, 注文数: 0, events: dayEvents };
        const info = groupProfitInfo?.[detailGroup] || { costPerUnit: 0, fbaFeeRate: 15, fbaShippingFee: 0 };
        const cost = info.costPerUnit * d.units;
        const referral = Math.round(d.sales * (info.fbaFeeRate / 100));
        const shipping = info.fbaShippingFee * d.units;
        const profit = d.sales - cost - referral - shipping;
        const cvr = d.sessions > 0 ? Math.round((d.orders / d.sessions) * 10000) / 100 : 0;
        return {
          date: dateKey,
          fullDate: date,
          セッション: d.sessions,
          CVR: cvr,
          売上: d.sales,
          利益: profit,
          注文数: d.orders,
          events: dayEvents,
        };
      });
  }, [detailGroup, groupDailyMetrics, detailEventsByDate]);

  // Sort function
  const sortFn = (a: any, b: any) => {
    if (sortKey === "profit_rate") return b.profit_rate - a.profit_rate;
    if (sortKey === "net_profit") return b.net_profit - a.net_profit;
    if (sortKey === "total_orders") return b.total_orders - a.total_orders;
    return b.total_sales - a.total_sales;
  };

  // Individual sorted products (共有フィルタで親ASIN・archived除外)
  const sortedProducts = [...filterOutParentAsins(productSummary as any[])].sort(sortFn);

  // Grouped products
  const groupedProducts = useMemo(() => {
    const filtered = filterOutParentAsins(productSummary as any[]);
    const groups = groupProducts(filtered, campaignAdByGroup as Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }>);
    return groups.sort(sortFn);
  }, [productSummary, sortKey, campaignAdByGroup]);

  // Toggle expand
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Data source for charts (use grouped or individual based on view)
  const chartSource = viewMode === "grouped" ? groupedProducts : sortedProducts;

  // Summary KPIs — グループ集計値を使用（キャンペーン広告費が正しく反映される）
  const totalSales = groupedProducts.reduce((s, g) => s + g.total_sales, 0);
  const totalCost = groupedProducts.reduce((s, g) => s + g.total_cost, 0);
  const totalFbaFee = groupedProducts.reduce((s, g) => s + g.total_fba_fee, 0);
  const totalPointCost = groupedProducts.reduce((s, g) => s + g.total_point_cost, 0);
  const totalAdSpend = groupedProducts.reduce((s, g) => s + g.total_ad_spend, 0);
  const totalProfit = groupedProducts.reduce((s, g) => s + g.net_profit, 0);
  const overallProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  // Profit bar chart data (top 10)
  const profitChartData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .slice(0, 10)
    .map((p: any) => {
      const name = viewMode === "grouped" ? p.groupName : (p.product?.name || "不明");
      const shortName = name.length > 20 ? name.slice(0, 20) + "…" : name;
      return {
        name: shortName,
        売上: p.total_sales,
        原価: p.total_cost || 0,
        FBA手数料: p.total_fba_fee || 0,
        広告費: p.total_ad_spend || 0,
        利益: p.net_profit || 0,
      };
    });

  // Profit rate comparison chart
  const profitRateData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .slice(0, 10)
    .map((p: any) => {
      const name = viewMode === "grouped" ? p.groupName : (p.product?.name || "不明");
      const shortName = name.length > 15 ? name.slice(0, 15) + "…" : name;
      return {
        name: shortName,
        利益率: Math.round(p.profit_rate * 10) / 10,
        利益: p.net_profit || 0,
      };
    });

  const pieData = chartSource
    .filter((p: any) => p.total_sales > 0)
    .map((p: any, i: number) => {
      const name = (viewMode === "grouped" ? p.groupName : (p.product?.name || "不明")).slice(0, 20);
      return {
        name,
        value: p.total_sales,
        color: getGroupColor(name, i),
      };
    });

  // Build group options from products (deduplicated product_group names)
  const groupOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [{ value: "", label: "グループを選択" }];
    for (const p of products as any[]) {
      const group = p.product_group || p.name;
      if (!seen.has(group)) {
        seen.add(group);
        opts.push({ value: group, label: group });
      }
    }
    return opts;
  }, [products]);

  // Monthly P&L and break-even ACoS calculation for selected detail group
  // Uses currentMonthSummary (dedicated current month query) for consistent numbers
  const bepData = useMemo(() => {
    if (!detailGroup) return null;

    const groupProds = (products as any[]).filter((p: any) => (p.product_group || p.name) === detailGroup);
    const groupProductIds = new Set(groupProds.map((p: any) => p.id));

    const groupSummary = (currentMonthSummary as any[]).filter((ps: any) => groupProductIds.has(ps.product?.id));
    const totalSales = groupSummary.reduce((s: number, p: any) => s + (p.total_sales || 0), 0);
    const totalUnits = groupSummary.reduce((s: number, p: any) => s + (p.total_units || 0), 0);
    const totalOrders = groupSummary.reduce((s: number, p: any) => s + (p.total_orders || 0), 0);
    const totalAdSpend = groupSummary.reduce((s: number, p: any) => s + (p.total_ad_spend || 0), 0);
    const totalAdSales = groupSummary.reduce((s: number, p: any) => s + (p.total_ad_sales || 0), 0);

    // Cost info from first product (representative for unit economics)
    const rep = groupProds[0] || {};
    const costPerUnit = rep.cost_price || 0;
    const fbaFeeRate = rep.fba_fee_rate || 15;
    const fbaShippingFee = rep.fba_shipping_fee || 0;
    const sellingPrice = rep.selling_price || 0;
    const referralPerUnit = sellingPrice > 0 ? Math.round(sellingPrice * fbaFeeRate / 100) : 0;
    const grossProfitPerUnit = sellingPrice - costPerUnit - referralPerUnit - fbaShippingFee;

    // Break-even ACoS = gross margin ratio (what % of ad-attributed sales can be spent on ads before going red)
    // = grossProfitPerUnit / sellingPrice * 100
    const breakEvenAcos = sellingPrice > 0 ? (grossProfitPerUnit / sellingPrice) * 100 : 0;

    // Current actual ACoS = ad_spend / ad_sales * 100
    const currentAcos = totalAdSales > 0 ? (totalAdSpend / totalAdSales) * 100 : 0;

    // Total cost & profit
    const totalCost = costPerUnit * totalUnits;
    const totalReferral = Math.round(totalSales * fbaFeeRate / 100);
    const totalShipping = fbaShippingFee * totalUnits;
    const grossProfit = totalSales - totalCost - totalReferral - totalShipping;
    const netProfit = grossProfit - totalAdSpend;

    // Goals
    const goal = (monthlyGoals as any[]).find((g: any) =>
      g.product_group === detailGroup && !g.product_id
    );

    // Month-end projections (linear extrapolation from current pace)
    const projectedSales = dayOfMonth > 0 ? Math.round(totalSales / dayOfMonth * daysInMonth) : 0;
    const projectedAdSpend = dayOfMonth > 0 ? Math.round(totalAdSpend / dayOfMonth * daysInMonth) : 0;
    const projectedProfit = dayOfMonth > 0 ? Math.round(netProfit / dayOfMonth * daysInMonth) : 0;

    return {
      totalSales, totalUnits, totalOrders, totalAdSpend, totalAdSales,
      grossProfit, netProfit, grossProfitPerUnit,
      breakEvenAcos, currentAcos,
      goal, projectedSales, projectedAdSpend, projectedProfit,
      sellingPrice,
    };
  }, [detailGroup, products, currentMonthSummary, monthlyGoals, dayOfMonth, daysInMonth]);

  // AI Consultant chat state
  const [aiMessages, setAiMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  const buildAiContext = useCallback(() => {
    if (!detailGroup || !bepData) return "";
    const goal = bepData.goal;
    const lines = [
      `【商品グループ】${detailGroup}`,
      `【期間】${currentMonthStart} 〜 ${currentMonthEnd} (${dayOfMonth}/${daysInMonth}日経過)`,
      ``,
      `■ 今月の実績`,
      `  売上: ¥${bepData.totalSales.toLocaleString()}`,
      `  注文数: ${bepData.totalOrders}件`,
      `  販売数: ${bepData.totalUnits}個`,
      `  広告費: ¥${bepData.totalAdSpend.toLocaleString()}`,
      `  粗利: ¥${bepData.grossProfit.toLocaleString()}`,
      `  純利益: ¥${bepData.netProfit.toLocaleString()}`,
      `  粗利/個: ¥${bepData.grossProfitPerUnit.toLocaleString()}`,
      `  損益分岐ACoS: ${bepData.breakEvenAcos.toFixed(1)}%`,
      `  今月ACoS: ${bepData.totalAdSales > 0 ? bepData.currentAcos.toFixed(1) + "%" : "データなし"}`,
      `  販売単価: ¥${bepData.sellingPrice.toLocaleString()}`,
    ];
    if (goal) {
      lines.push(``, `■ 月間目標`);
      if (goal.target_sales) lines.push(`  売上目標: ¥${goal.target_sales.toLocaleString()} (達成率: ${(bepData.totalSales / goal.target_sales * 100).toFixed(1)}%)`);
      if (goal.target_profit) lines.push(`  利益目標: ¥${goal.target_profit.toLocaleString()}`);
      if (goal.target_orders) lines.push(`  注文目標: ${goal.target_orders}件`);
    }
    lines.push(``, `■ 月末予測（現在ペース）`);
    lines.push(`  予想売上: ¥${bepData.projectedSales.toLocaleString()}`);
    lines.push(`  想定広告費: ¥${bepData.projectedAdSpend.toLocaleString()}`);
    lines.push(`  予想純利益: ¥${bepData.projectedProfit.toLocaleString()}`);

    if (detailChartData.length > 0) {
      const recent = detailChartData.slice(-7);
      lines.push(``, `■ 直近${recent.length}日のセッション×CVR推移`);
      for (const d of recent) {
        lines.push(`  ${d.date}: セッション=${(d as any).セッション} CVR=${(d as any).CVR}% 注文=${(d as any).注文数}件 売上=¥${(d as any).売上?.toLocaleString()}`);
      }
    }

    const groupEvents = (productEvents as any[]).filter((e: any) => e.product_group === detailGroup);
    if (groupEvents.length > 0) {
      lines.push(``, `■ 登録済み施策`);
      for (const ev of groupEvents.slice(-10)) {
        lines.push(`  ${ev.date}: [${ev.event_type}] ${ev.memo || "(メモなし)"}`);
      }
    }
    return lines.join("\n");
  }, [detailGroup, bepData, currentMonthStart, currentMonthEnd, dayOfMonth, daysInMonth, detailChartData, productEvents]);

  const sendAiMessage = useCallback(async (userMessage?: string) => {
    const msg = userMessage || aiInput.trim();
    if (!msg) return;
    setAiInput("");
    const newMessages = [...aiMessages, { role: "user" as const, content: msg }];
    setAiMessages(newMessages);
    setAiLoading(true);

    const showError = (errorMsg: string) => {
      setAiMessages([...newMessages, { role: "assistant", content: `⚠️ ${errorMsg}` }]);
      setAiLoading(false);
    };

    try {
      const context = newMessages.length === 1 ? buildAiContext() : "";
      let res: Response;
      try {
        res = await fetch("/api/ai-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: newMessages, context }),
        });
      } catch (fetchErr) {
        showError("サーバーに接続できません。ネットワーク接続を確認してください。");
        return;
      }

      // Non-SSE error response (JSON)
      if (!res.ok) {
        let errorMsg = `サーバーエラー (${res.status})`;
        try {
          const err = await res.json();
          errorMsg = err.error || errorMsg;
        } catch {}
        showError(errorMsg);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        showError("レスポンスの読み取りに失敗しました");
        return;
      }

      const decoder = new TextDecoder();
      let assistantText = "";
      let hasError = false;
      setAiMessages([...newMessages, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              // SSE error event from server
              showError(parsed.error);
              hasError = true;
              break;
            }
            if (parsed.text) {
              assistantText += parsed.text;
              setAiMessages([...newMessages, { role: "assistant", content: assistantText }]);
            }
          } catch {}
        }
        if (hasError) break;
      }

      if (!hasError && !assistantText) {
        showError("AIからの応答がありませんでした。APIキーの設定を確認してください。");
        return;
      }

      if (!hasError) {
        setTimeout(() => aiScrollRef.current?.scrollTo({ top: aiScrollRef.current.scrollHeight, behavior: "smooth" }), 100);
        setAiLoading(false);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "予期しないエラーが発生しました");
    }
  }, [aiInput, aiMessages, buildAiContext]);

  // Last month chart data for comparison
  const lastMonthChartData = useMemo(() => {
    if (!detailGroup || lastMonthSales.length === 0) return [];
    const pidToGroup = new Map<string, string>();
    for (const p of products as any[]) pidToGroup.set(p.id, p.product_group || p.name);

    const groupProfitInfo = (products as any[]).find((p: any) => (p.product_group || p.name) === detailGroup);
    const info = { costPerUnit: groupProfitInfo?.cost_price || 0, fbaFeeRate: groupProfitInfo?.fba_fee_rate || 15, fbaShippingFee: groupProfitInfo?.fba_shipping_fee || 0 };

    const dateMap: Record<string, { sessions: number; orders: number; units: number; sales: number }> = {};
    for (const d of lastMonthSales as any[]) {
      const group = pidToGroup.get(d.product_id);
      if (group !== detailGroup) continue;
      const date = d.date;
      if (!dateMap[date]) dateMap[date] = { sessions: 0, orders: 0, units: 0, sales: 0 };
      dateMap[date].sessions += d.sessions || 0;
      dateMap[date].orders += d.orders || 0;
      dateMap[date].units += d.units_sold || 0;
      dateMap[date].sales += d.sales_amount || 0;
    }

    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        const cost = info.costPerUnit * d.units;
        const referral = Math.round(d.sales * (info.fbaFeeRate / 100));
        const shipping = info.fbaShippingFee * d.units;
        const cvr = d.sessions > 0 ? Math.round((d.orders / d.sessions) * 10000) / 100 : 0;
        return {
          date: date.slice(8), // day only for overlay comparison
          セッション: d.sessions, CVR: cvr, 売上: d.sales,
          利益: d.sales - cost - referral - shipping, 注文数: d.orders,
        };
      });
  }, [detailGroup, lastMonthSales, products]);

  const sortOptions = [
    { value: "total_sales", label: "売上順" },
    { value: "net_profit", label: "利益順" },
    { value: "profit_rate", label: "利益率順" },
    { value: "total_orders", label: "注文数順" },
  ];

  const viewOptions = [
    { value: "grouped", label: "親ASIN別" },
    { value: "individual", label: "子ASIN別" },
  ];

  return (
    <div>
      <PageHeader title="商品別分析" description="商品ごとの売上・利益分析">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
            {viewOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setViewMode(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === opt.value
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
      </PageHeader>

      {/* Profit KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">総売上</p>
            <p className="text-lg font-bold text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">純利益</p>
            <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(totalProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">利益率</p>
            <p className={`text-lg font-bold ${overallProfitRate >= 0 ? "text-green-500" : "text-red-500"}`}>{formatPercent(overallProfitRate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">原価合計</p>
            <p className="text-lg font-bold">{formatCurrency(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">FBA手数料</p>
            <p className="text-lg font-bold">{formatCurrency(totalFbaFee)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">広告費</p>
            <p className="text-lg font-bold">{formatCurrency(totalAdSpend)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profit Breakdown Chart */}
        <Card>
          <CardHeader>
            <CardTitle>商品別 売上・コスト内訳</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={profitChartData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={11} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={10} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="利益" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="原価" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                <Bar dataKey="FBA手数料" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="広告費" stackId="a" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Profit Rate Comparison */}
        <Card>
          <CardHeader>
            <CardTitle>商品別 利益率比較</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={profitRateData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={11} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={10} width={120} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                  labelStyle={{ color: "#fff", fontWeight: 600 }}
                  itemStyle={{ color: "#fff" }}
                  formatter={(value: any, name: string) => name === "利益率" ? `${value}%` : formatCurrency(value)}
                />
                <ReferenceLine x={0} stroke="hsl(0 0% 40%)" />
                <Bar dataKey="利益率" radius={[0, 4, 4, 0]}>
                  {profitRateData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry["利益率"] >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sales Composition Pie + Product Trend */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>売上構成比</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }} formatter={(value: any) => formatCurrency(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>月間損益・広告効率</CardTitle>
            <Select options={groupOptions} value={detailGroup} onChange={(e) => setDetailGroup(e.target.value)} className="w-48" />
          </CardHeader>
          <CardContent>
            {detailGroup && bepData ? (
              <div className="space-y-4">
                {/* Sales progress */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[hsl(var(--muted-foreground))]">売上 ({dayOfMonth}/{daysInMonth}日)</span>
                    <span className="font-medium">{formatCurrency(bepData.totalSales)}{bepData.goal ? ` / ${formatCurrency(bepData.goal.target_sales)}` : ""}</span>
                  </div>
                  <div className="h-3 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(100, bepData.goal?.target_sales ? (bepData.totalSales / bepData.goal.target_sales) * 100 : (dayOfMonth / daysInMonth) * 100)}%`,
                      backgroundColor: getGroupColor(detailGroup, 0),
                    }} />
                  </div>
                </div>

                {/* Profit progress */}
                {bepData.goal?.target_profit ? (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[hsl(var(--muted-foreground))]">利益</span>
                      <span className={`font-medium ${bepData.netProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(bepData.netProfit)} / {formatCurrency(bepData.goal.target_profit)}</span>
                    </div>
                    <div className="h-3 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                      <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, (bepData.netProfit / bepData.goal.target_profit) * 100))}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">利益目標: <a href="/goals" className="text-[hsl(var(--primary))] underline">目標管理</a>で設定</p>
                )}

                {/* Break-even ACoS indicator */}
                <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">損益分岐ACoS（限界利益率）</p>
                  {bepData.breakEvenAcos > 0 ? (
                    <div className="flex items-end gap-6">
                      <div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">損益分岐</p>
                        <p className="text-2xl font-bold">{formatPercent(bepData.breakEvenAcos)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">今月ACoS</p>
                        <p className={`text-2xl font-bold ${bepData.currentAcos > 0 && bepData.currentAcos < bepData.breakEvenAcos ? "text-green-500" : bepData.currentAcos >= bepData.breakEvenAcos ? "text-red-500" : ""}`}>
                          {bepData.totalAdSales > 0 ? formatPercent(bepData.currentAcos) : "-"}
                        </p>
                      </div>
                      <div className="flex-1 text-xs">
                        {bepData.totalAdSales > 0 && bepData.currentAcos < bepData.breakEvenAcos ? (
                          <p className="text-green-500">ACoSが損益分岐を下回っています。広告は黒字圏内です。</p>
                        ) : bepData.totalAdSales > 0 && bepData.currentAcos >= bepData.breakEvenAcos ? (
                          <p className="text-red-400">ACoSが損益分岐を超えています。広告費の見直しを検討してください。</p>
                        ) : (
                          <p className="text-[hsl(var(--muted-foreground))]">広告売上データがありません</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-red-400">粗利がマイナスです（原価・手数料を確認）</p>
                  )}
                  <div className="flex gap-4 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>粗利/個: {formatCurrency(bepData.grossProfitPerUnit)}</span>
                    <span>販売単価: {formatCurrency(bepData.sellingPrice)}</span>
                    <span>広告費: {formatCurrency(bepData.totalAdSpend)}</span>
                  </div>
                </div>

                {/* Month-end projection */}
                <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">月末着地見込み（現在ペース）</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">予想売上</p>
                      <p className="text-xl font-bold">{formatCurrency(bepData.projectedSales)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">想定広告費</p>
                      <p className="text-xl font-bold">{formatCurrency(bepData.projectedAdSpend)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">予想純利益</p>
                      <p className={`text-xl font-bold ${bepData.projectedProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrency(bepData.projectedProfit)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-[hsl(var(--muted-foreground))]">
                グループを選択してください
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Metrics Chart with Tabs */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>商品グループ別メトリクス</CardTitle>
          <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
            {[
              { value: "bsr", label: "BSR" },
              { value: "sessions", label: "セッション" },
              { value: "cvr", label: "CVR" },
              { value: "sales", label: "売上" },
              { value: "profit", label: "利益" },
            ].map(tab => (
              <button
                key={tab.value}
                onClick={() => setMetricsTab(tab.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  metricsTab === tab.value
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {metricsTab === "bsr" ? (
            bsrChartData && "data" in bsrChartData && bsrChartData.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={bsrChartData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                  <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                  <YAxis
                    stroke="hsl(0 0% 50%)"
                    fontSize={12}
                    reversed
                    label={{ value: "順位", angle: -90, position: "insideLeft", style: { fill: "hsl(0 0% 50%)" } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                    formatter={(value: any) => `#${value}`}
                  />
                  <Legend />
                  {bsrChartData.products.map((name: string, i: number) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={getGroupColor(name, i)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[350px] items-center justify-center text-[hsl(var(--muted-foreground))]">BSRデータがありません</div>
            )
          ) : metricsChartData.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={metricsChartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis
                  stroke="hsl(0 0% 50%)"
                  fontSize={12}
                  tickFormatter={
                    metricsTab === "sales" || metricsTab === "profit"
                      ? (v) => `¥${(v / 10000).toFixed(0)}万`
                      : metricsTab === "cvr"
                      ? (v) => `${v}%`
                      : undefined
                  }
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                  formatter={(value: any) =>
                    metricsTab === "sales" || metricsTab === "profit"
                      ? formatCurrency(value)
                      : metricsTab === "cvr"
                      ? `${value}%`
                      : formatNumber(value)
                  }
                />
                <Legend />
                {metricsChartData.groups.map((name: string, i: number) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={getGroupColor(name, i)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[350px] items-center justify-center text-[hsl(var(--muted-foreground))]">データがありません</div>
          )}
        </CardContent>
      </Card>

      {/* Group Detail Analysis with Last Month Comparison */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>商品グループ詳細分析</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
              <button onClick={() => setDetailPeriod("current")} className={`px-3 py-1.5 text-xs font-medium transition-colors ${detailPeriod === "current" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>今月</button>
              <button onClick={() => setDetailPeriod("compare")} className={`px-3 py-1.5 text-xs font-medium transition-colors ${detailPeriod === "compare" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>先月比較</button>
            </div>
            <Select options={groupOptions} value={detailGroup} onChange={(e) => setDetailGroup(e.target.value)} className="w-48" />
          </div>
        </CardHeader>
        <CardContent>
          {detailGroup && detailChartData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Sessions + CVR composite */}
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2 font-medium">セッション数 × CVR{detailPeriod === "compare" ? " (実線=今月 / 破線=先月)" : ""}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={detailPeriod === "compare"
                    ? detailChartData.map((d, i) => ({ ...d, "先月セッション": lastMonthChartData[i]?.セッション, "先月CVR": lastMonthChartData[i]?.CVR }))
                    : detailChartData
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                    <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={10} />
                    <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={10} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 40%)" fontSize={10} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                      formatter={(value: any, name: string) => name.includes("CVR") ? `${value}%` : formatNumber(value)}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const entry = payload[0]?.payload;
                        const evts = entry?.events || [];
                        return (
                          <div style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" }}>
                            <p style={{ fontWeight: "bold", marginBottom: 4 }}>{label}</p>
                            {payload.map((p: any, i: number) => (
                              <p key={i} style={{ color: p.color }}>{p.name}: {p.name.includes("CVR") ? `${p.value}%` : formatNumber(p.value)}</p>
                            ))}
                            {evts.length > 0 && (
                              <div style={{ borderTop: "1px solid hsl(0 0% 25%)", marginTop: 6, paddingTop: 6 }}>
                                {evts.map((ev: any, i: number) => (
                                  <p key={i} style={{ color: "#f59e0b" }}>📌 [{EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}] {ev.memo || ""}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    {/* Event markers as ReferenceLines */}
                    {detailChartData.filter((d: any) => d.events?.length > 0).map((d: any) => (
                      <ReferenceLine key={`ev-${d.date}`} x={d.date} yAxisId="left" stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: "📌", position: "top", fontSize: 12 }} />
                    ))}
                    <Bar yAxisId="left" dataKey="セッション" fill={getGroupColor(detailGroup, 0)} opacity={0.7} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="CVR" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                    {detailPeriod === "compare" && <>
                      <Bar yAxisId="left" dataKey="先月セッション" fill="hsl(0 0% 40%)" opacity={0.3} radius={[3, 3, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="先月CVR" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    </>}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Sales + Profit composite */}
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2 font-medium">売上 × 利益{detailPeriod === "compare" ? " (実線=今月 / 破線=先月)" : ""}</p>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={detailPeriod === "compare"
                    ? detailChartData.map((d, i) => ({ ...d, "先月売上": lastMonthChartData[i]?.売上, "先月利益": lastMonthChartData[i]?.利益 }))
                    : detailChartData
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                    <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={10} />
                    <YAxis stroke="hsl(0 0% 50%)" fontSize={10} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const entry = payload[0]?.payload;
                        const evts = entry?.events || [];
                        return (
                          <div style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" }}>
                            <p style={{ fontWeight: "bold", marginBottom: 4 }}>{label}</p>
                            {payload.map((p: any, i: number) => (
                              <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>
                            ))}
                            {evts.length > 0 && (
                              <div style={{ borderTop: "1px solid hsl(0 0% 25%)", marginTop: 6, paddingTop: 6 }}>
                                {evts.map((ev: any, i: number) => (
                                  <p key={i} style={{ color: "#f59e0b" }}>📌 [{EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}] {ev.memo || ""}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    {detailChartData.filter((d: any) => d.events?.length > 0).map((d: any) => (
                      <ReferenceLine key={`ev2-${d.date}`} x={d.date} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: "📌", position: "top", fontSize: 12 }} />
                    ))}
                    <Bar dataKey="売上" fill={getGroupColor(detailGroup, 0)} opacity={0.7} radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="利益" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                    {detailPeriod === "compare" && <>
                      <Bar dataKey="先月売上" fill="hsl(0 0% 40%)" opacity={0.3} radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="先月利益" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    </>}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Orders trend */}
              <div className="lg:col-span-2">
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2 font-medium">注文数推移{detailPeriod === "compare" ? " (色付き=今月 / グレー=先月)" : ""}</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={detailPeriod === "compare"
                    ? detailChartData.map((d, i) => ({ ...d, "先月注文数": lastMonthChartData[i]?.注文数 }))
                    : detailChartData
                  }>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                    <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={10} />
                    <YAxis stroke="hsl(0 0% 50%)" fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", color: "#fff" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const entry = payload[0]?.payload;
                        const evts = entry?.events || [];
                        return (
                          <div style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px", padding: "8px 12px", fontSize: "12px" }}>
                            <p style={{ fontWeight: "bold", marginBottom: 4 }}>{label}</p>
                            {payload.map((p: any, i: number) => (
                              <p key={i} style={{ color: p.color }}>{p.name}: {p.value}件</p>
                            ))}
                            {evts.length > 0 && (
                              <div style={{ borderTop: "1px solid hsl(0 0% 25%)", marginTop: 6, paddingTop: 6 }}>
                                {evts.map((ev: any, i: number) => (
                                  <p key={i} style={{ color: "#f59e0b" }}>📌 [{EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}] {ev.memo || ""}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    {detailChartData.filter((d: any) => d.events?.length > 0).map((d: any) => (
                      <ReferenceLine key={`ev3-${d.date}`} x={d.date} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: "📌", position: "top", fontSize: 12 }} />
                    ))}
                    <Bar dataKey="注文数" fill={getGroupColor(detailGroup, 0)} radius={[3, 3, 0, 0]} />
                    {detailPeriod === "compare" && <Bar dataKey="先月注文数" fill="hsl(0 0% 40%)" opacity={0.4} radius={[3, 3, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-[hsl(var(--muted-foreground))]">
              グループを選択してください
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Product Table */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>商品別損益テーブル</CardTitle>
          <div className="flex items-center gap-2">
            <Select options={sortOptions} value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="w-36" />
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">{viewMode === "grouped" ? "商品グループ" : "商品名"}</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">FBA手数料</TableHead>
                <TableHead className="text-right">ポイント</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">粗利</TableHead>
                <TableHead className="text-right">純利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">個あたり利益</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {viewMode === "grouped" ? (
                <>
                  {groupedProducts.map((g: GroupedProduct, gi: number) => (
                    <>
                      {/* Group header row */}
                      <TableRow
                        key={`group-${gi}`}
                        className="cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                        onClick={() => toggleGroup(g.groupKey)}
                      >
                        <TableCell className="font-bold text-sm">
                          <span className="mr-2 inline-block w-4 text-center text-[hsl(var(--muted-foreground))]">
                            {expandedGroups.has(g.groupKey) ? "▼" : "▶"}
                          </span>
                          {g.groupName}
                          <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">({g.children.length}件)</span>
                        </TableCell>
                        <TableCell className="text-right font-bold text-[hsl(var(--primary))]">{formatCurrency(g.total_sales)}</TableCell>
                        <TableCell className="text-right font-bold">{formatNumber(g.total_orders)}</TableCell>
                        <TableCell className="text-right font-bold text-red-400">{formatCurrency(g.total_cost)}</TableCell>
                        <TableCell className="text-right font-bold text-yellow-400">{formatCurrency(g.total_fba_fee)}</TableCell>
                        <TableCell className="text-right font-bold text-orange-400">{g.total_point_cost > 0 ? formatCurrency(g.total_point_cost) : "—"}</TableCell>
                        <TableCell className="text-right font-bold text-purple-400">{formatCurrency(g.total_ad_spend)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(g.gross_profit)}</TableCell>
                        <TableCell className={`text-right font-bold ${g.net_profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatCurrency(g.net_profit)}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${g.profit_rate >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatPercent(g.profit_rate)}
                        </TableCell>
                        <TableCell className="text-right font-bold">{formatNumber(g.total_sessions)}</TableCell>
                        <TableCell className="text-right font-bold">
                          {g.total_sessions > 0 && g.total_sessions >= g.total_orders * 0.5 ? formatPercent((g.total_orders / g.total_sessions) * 100) : "-"}
                        </TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(g.unit_profit)}</TableCell>
                      </TableRow>
                      {/* Expanded children rows */}
                      {expandedGroups.has(g.groupKey) && g.children
                        .sort((a: any, b: any) => b.total_sales - a.total_sales)
                        .map((p: any, ci: number) => (
                        <TableRow key={`child-${gi}-${ci}`} className="bg-[hsl(var(--muted)/0.3)]">
                          <TableCell className="text-sm max-w-[300px] truncate pl-10" title={p.product?.name}>
                            <span className="text-[hsl(var(--muted-foreground))]">└</span>{" "}
                            {p.product?.name || "不明"}
                            {p.product?.asin && (
                              <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{p.product.asin}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                          <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                          <TableCell className="text-right text-red-400">{formatCurrency(p.total_cost || 0)}</TableCell>
                          <TableCell className="text-right text-yellow-400">{formatCurrency(p.total_fba_fee || 0)}</TableCell>
                          <TableCell className="text-right text-orange-400">{(p.total_point_cost || 0) > 0 ? formatCurrency(p.total_point_cost) : "—"}</TableCell>
                          <TableCell className="text-right text-[hsl(var(--muted-foreground))]">—</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.gross_profit || 0)}</TableCell>
                          <TableCell className="text-right text-[hsl(var(--muted-foreground))]">—</TableCell>
                          <TableCell className="text-right text-[hsl(var(--muted-foreground))]">—</TableCell>
                          <TableCell className="text-right">{formatNumber(p.total_sessions || 0)}</TableCell>
                          <TableCell className="text-right">
                            {(p.total_sessions || 0) > 0 && (p.total_sessions || 0) >= (p.total_orders || 0) * 0.5 ? formatPercent(((p.total_orders || 0) / p.total_sessions) * 100) : "-"}
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                        </TableRow>
                      ))}
                    </>
                  ))}
                </>
              ) : (
                <>
                  {sortedProducts.map((p: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm max-w-[300px] truncate" title={p.product?.name}>
                        {p.product?.name || "不明"}
                        {p.product?.asin && (
                          <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{p.product.asin}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                      <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                      <TableCell className="text-right text-red-400">{formatCurrency(p.total_cost || 0)}</TableCell>
                      <TableCell className="text-right text-yellow-400">{formatCurrency(p.total_fba_fee || 0)}</TableCell>
                      <TableCell className="text-right text-orange-400">{(p.total_point_cost || 0) > 0 ? formatCurrency(p.total_point_cost) : "—"}</TableCell>
                      <TableCell className="text-right text-purple-400">{formatCurrency(p.total_ad_spend || 0)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.gross_profit || 0)}</TableCell>
                      <TableCell className={`text-right font-bold ${(p.net_profit || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrency(p.net_profit || 0)}
                      </TableCell>
                      <TableCell className={`text-right ${(p.profit_rate || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatPercent(p.profit_rate || 0)}
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(p.total_sessions || 0)}</TableCell>
                      <TableCell className="text-right">
                        {(p.total_sessions || 0) > 0 && (p.total_sessions || 0) >= (p.total_orders || 0) * 0.5 ? formatPercent(((p.total_orders || 0) / p.total_sessions) * 100) : "-"}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(p.unit_profit || 0)}</TableCell>
                    </TableRow>
                  ))}
                </>
              )}
              {/* Total row */}
              {sortedProducts.length > 0 && (
                <TableRow className="border-t-2 border-[hsl(var(--border))] font-bold bg-[hsl(var(--muted))]">
                  <TableCell>合計</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(totalSales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(sortedProducts.reduce((s: number, p: any) => s + p.total_orders, 0))}</TableCell>
                  <TableCell className="text-right text-red-400">{formatCurrency(totalCost)}</TableCell>
                  <TableCell className="text-right text-yellow-400">{formatCurrency(totalFbaFee)}</TableCell>
                  <TableCell className="text-right text-orange-400">{totalPointCost > 0 ? formatCurrency(totalPointCost) : "—"}</TableCell>
                  <TableCell className="text-right text-purple-400">{formatCurrency(totalAdSpend)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(totalSales - totalCost - totalFbaFee - totalPointCost)}</TableCell>
                  <TableCell className={`text-right ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(totalProfit)}</TableCell>
                  <TableCell className={`text-right ${overallProfitRate >= 0 ? "text-green-500" : "text-red-500"}`}>{formatPercent(overallProfitRate)}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(sortedProducts.reduce((s: number, p: any) => s + (p.total_sessions || 0), 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => { const ts = sortedProducts.reduce((s: number, p: any) => s + (p.total_sessions || 0), 0); const to = sortedProducts.reduce((s: number, p: any) => s + p.total_orders, 0); return ts > 0 && ts >= to * 0.5 ? formatPercent((to / ts) * 100) : "-"; })()}
                  </TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {/* AI Consultant Panel */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>AI コンサルタント</CardTitle>
          <div className="flex items-center gap-2">
            <Select options={groupOptions} value={detailGroup} onChange={(e) => setDetailGroup(e.target.value)} className="w-48" />
            {detailGroup && (
              <Button
                size="sm"
                onClick={() => {
                  setAiOpen(true);
                  if (aiMessages.length === 0) {
                    sendAiMessage(`「${detailGroup}」の今月のデータを分析し、現状サマリー・課題・施策提案をレポートしてください。`);
                  }
                }}
                disabled={!detailGroup}
              >
                {aiMessages.length > 0 ? "チャットを開く" : "AIに分析させる"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!detailGroup ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">商品グループを選択して「AIに分析させる」を押してください</p>
          ) : !aiOpen ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">「AIに分析させる」ボタンでAIコンサルタントが今月のデータを元に分析・提案します</p>
          ) : (
            <div>
              {/* Chat messages */}
              <div ref={aiScrollRef} className="max-h-[500px] overflow-y-auto space-y-3 mb-4 pr-1">
                {aiMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                        : "bg-[hsl(var(--muted))]"
                    }`}>
                      {msg.role === "assistant" ? (
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content || (aiLoading && i === aiMessages.length - 1 ? "考え中..." : "")}</div>
                      ) : (
                        <div>{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Input */}
              <form
                onSubmit={(e) => { e.preventDefault(); sendAiMessage(); }}
                className="flex gap-2"
              >
                <Input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="質問を入力... 例: 広告費を削減すべき？ / CVR改善の施策は？"
                  disabled={aiLoading}
                  className="flex-1"
                />
                <Button type="submit" disabled={aiLoading || !aiInput.trim()} size="sm">
                  送信
                </Button>
              </form>

              {/* Quick action buttons */}
              {aiMessages.length > 0 && !aiLoading && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {[
                    "広告費を減らすべきですか？",
                    "CVRを上げる施策を提案して",
                    "画像A/Bテストのアイデアは？",
                    "来月の目標はいくらが妥当？",
                  ].map((q) => (
                    <button
                      key={q}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                      onClick={() => sendAiMessage(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
