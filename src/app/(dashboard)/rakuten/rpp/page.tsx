"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { Megaphone, DollarSign, MousePointerClick, TrendingUp } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

async function getRakutenAdData(params: { startDate?: string; endDate?: string }) {
  let query = supabase
    .from("rakuten_daily_advertising")
    .select("*, rakuten_product:rakuten_products(*)")
    .order("date", { ascending: false });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getRakutenAdData error:", error); return []; }
  return data || [];
}

export default function RakutenRppPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: adData = [] } = useQuery({
    queryKey: ["rakutenAd", dateRange],
    queryFn: () => getRakutenAdData(dateRange),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummary", dateRange],
    queryFn: () => getRakutenProductSalesSummary(dateRange),
  });

  const totalSales = (productSummary as any[]).reduce((s: number, p: any) => s + p.total_sales, 0);
  const totalAdSpend = (adData as any[]).reduce((s: number, r: any) => s + (r.ad_spend || 0), 0);
  const totalAdSales = (adData as any[]).reduce((s: number, r: any) => s + (r.ad_sales || 0), 0);
  const totalClicks = (adData as any[]).reduce((s: number, r: any) => s + (r.clicks || 0), 0);
  const totalImpressions = (adData as any[]).reduce((s: number, r: any) => s + (r.impressions || 0), 0);
  const avgAcos = totalAdSales > 0 ? (totalAdSpend / totalAdSales) * 100 : 0;
  const roas = totalAdSpend > 0 ? (totalAdSales / totalAdSpend) * 100 : 0;
  const tacos = totalSales > 0 ? (totalAdSpend / totalSales) * 100 : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // Aggregate by date
  const dailyAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const d = row.date;
    if (!acc[d]) acc[d] = { date: d, ad_spend: 0, ad_sales: 0, clicks: 0, impressions: 0 };
    acc[d].ad_spend += row.ad_spend || 0;
    acc[d].ad_sales += row.ad_sales || 0;
    acc[d].clicks += row.clicks || 0;
    acc[d].impressions += row.impressions || 0;
    return acc;
  }, {});

  const chartData = Object.values(dailyAgg)
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .map((d: any) => ({
      date: d.date.slice(5),
      広告費: d.ad_spend,
      広告売上: d.ad_sales,
      ACOS: d.ad_sales > 0 ? ((d.ad_spend / d.ad_sales) * 100).toFixed(1) : 0,
    }));

  // Aggregate by product_group
  const groupAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const group = row.rakuten_product?.product_group || row.rakuten_product?.name || "未分類";
    if (!acc[group]) acc[group] = { group, ad_spend: 0, ad_sales: 0, ad_orders: 0, clicks: 0, impressions: 0, productIds: new Set<string>() };
    acc[group].ad_spend += row.ad_spend || 0;
    acc[group].ad_sales += row.ad_sales || 0;
    acc[group].ad_orders += row.ad_orders || 0;
    acc[group].clicks += row.clicks || 0;
    acc[group].impressions += row.impressions || 0;
    if (row.product_id) acc[group].productIds.add(row.product_id);
    return acc;
  }, {});

  const groupAdData = Object.values(groupAgg).sort((a: any, b: any) => b.ad_spend - a.ad_spend);

  return (
    <div>
      <PageHeader title="【楽天】RPP広告管理" description="楽天RPP広告の分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KPICard title="広告費合計" value={formatCurrency(totalAdSpend)} icon={Megaphone} />
        <KPICard title="広告売上" value={formatCurrency(totalAdSales)} icon={DollarSign} />
        <KPICard title="ROAS" value={formatPercent(roas)} icon={TrendingUp} valueClassName={roas > 300 ? "text-[hsl(var(--success))]" : ""} />
        <KPICard title="ACoS" value={formatPercent(avgAcos)} icon={TrendingUp} valueClassName={avgAcos < 30 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"} />
        <KPICard title="TACoS" value={formatPercent(tacos)} icon={TrendingUp} valueClassName={tacos < 10 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"} />
        <KPICard title="CTR" value={formatPercent(ctr)} icon={MousePointerClick} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>広告費・売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 50%)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
              <Legend />
              <Bar yAxisId="left" dataKey="広告費" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="広告売上" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="ACOS" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>商品グループ別広告データ</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品グループ</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">広告売上</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">ACoS</TableHead>
                <TableHead className="text-right">TACoS</TableHead>
                <TableHead className="text-right">クリック</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">広告CVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupAdData.map((g: any, i: number) => {
                const acos = g.ad_sales > 0 ? (g.ad_spend / g.ad_sales) * 100 : 0;
                const grpRoas = g.ad_spend > 0 ? (g.ad_sales / g.ad_spend) * 100 : 0;
                const grpTotalSales = (productSummary as any[])
                  .filter((ps: any) => g.productIds.has(ps.product?.id))
                  .reduce((s: number, ps: any) => s + ps.total_sales, 0);
                const grpTacos = grpTotalSales > 0 ? (g.ad_spend / grpTotalSales) * 100 : 0;
                const grpCtr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
                const grpCvr = g.clicks > 0 && g.ad_orders > 0 ? (g.ad_orders / g.clicks) * 100 : 0;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{g.group}</TableCell>
                    <TableCell className="text-right">{formatCurrency(g.ad_spend)}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(g.ad_sales)}</TableCell>
                    <TableCell className={`text-right ${grpRoas > 300 ? "text-[hsl(var(--success))]" : ""}`}>{formatPercent(grpRoas)}</TableCell>
                    <TableCell className={`text-right ${acos < 30 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>{formatPercent(acos)}</TableCell>
                    <TableCell className={`text-right ${grpTacos < 10 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>{grpTotalSales > 0 ? formatPercent(grpTacos) : "-"}</TableCell>
                    <TableCell className="text-right">{formatNumber(g.clicks)}</TableCell>
                    <TableCell className="text-right">{formatPercent(grpCtr)}</TableCell>
                    <TableCell className="text-right">{g.ad_orders > 0 ? formatPercent(grpCvr) : "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
