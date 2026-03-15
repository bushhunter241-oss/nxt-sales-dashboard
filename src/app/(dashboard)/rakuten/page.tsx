"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { KPICard } from "@/components/layout/kpi-card";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getAggregatedRakutenDailySales, getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { getRakutenAdSummary } from "@/lib/api/rakuten-advertising";
import { DollarSign, TrendingUp, ShoppingCart, Eye, BarChart3, Megaphone } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const RAKUTEN_CHART_COLOR = "#bf0000";

export default function RakutenDashboardPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: dailySales = [] } = useQuery({
    queryKey: ["rakutenAggregatedSales", dateRange],
    queryFn: () => getAggregatedRakutenDailySales(dateRange),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummary", dateRange],
    queryFn: () => getRakutenProductSalesSummary(dateRange),
  });

  const { data: adSummary = { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({
    queryKey: ["rakutenAdSummary", dateRange],
    queryFn: () => getRakutenAdSummary(dateRange),
  });

  const totalSales = (dailySales as any[]).reduce((sum: number, d: any) => sum + d.sales_amount, 0);
  const totalOrders = (dailySales as any[]).reduce((sum: number, d: any) => sum + d.orders, 0);
  const totalAccess = (dailySales as any[]).reduce((sum: number, d: any) => sum + d.access_count, 0);
  const avgCvr = totalAccess > 0 ? (totalOrders / totalAccess) * 100 : 0;
  const totalAdSpend = adSummary?.total_ad_spend || 0;
  const tacos = totalSales > 0 ? (totalAdSpend / totalSales) * 100 : 0;

  const chartData = (dailySales as any[]).map((d: any) => ({
    date: d.date.slice(5),
    売上: d.sales_amount,
    注文数: d.orders,
  }));

  return (
    <div>
      <PageHeader title="🔴 楽天 ダッシュボード" description="楽天市場の売上・利益の概要">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
        <KPICard title="アクセス" value={formatNumber(totalAccess)} icon={Eye} />
        <KPICard title="CVR" value={formatPercent(avgCvr)} icon={BarChart3} valueClassName={avgCvr > 5 ? "text-[hsl(var(--success))]" : ""} />
        <KPICard title="RPP広告費" value={formatCurrency(totalAdSpend)} icon={Megaphone} />
        <KPICard title="TACoS" value={formatPercent(tacos)} icon={TrendingUp} valueClassName={tacos < 10 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>売上推移</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                  labelStyle={{ color: "hsl(0 0% 70%)" }}
                  formatter={(value: any) => formatCurrency(value)}
                />
                <Legend />
                <Bar dataKey="売上" fill={RAKUTEN_CHART_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>商品ランキング</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(productSummary as any[])
                .sort((a: any, b: any) => b.total_sales - a.total_sales)
                .slice(0, 5)
                .map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-red-600 text-white" : "bg-[hsl(var(--muted))]"}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm">{p.product?.name || "不明"}</span>
                    </div>
                    <span className="text-sm font-medium">{formatCurrency(p.total_sales)}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>商品別損益</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">アクセス</TableHead>
                <TableHead className="text-right">CVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(productSummary as any[])
                .sort((a: any, b: any) => b.total_sales - a.total_sales)
                .map((p: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.product?.name || "不明"}</TableCell>
                    <TableCell className="text-right text-red-500">{formatCurrency(p.total_sales)}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.total_access)}</TableCell>
                    <TableCell className="text-right">{p.total_access > 0 ? formatPercent((p.total_orders / p.total_access) * 100) : "0%"}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
