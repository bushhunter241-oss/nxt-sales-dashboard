"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent, getDateRange } from "@/lib/utils";
import { getShopifyDailySummary, getMetaAdSummary } from "@/lib/api/shopify-sales";
import { DollarSign, ShoppingCart, Megaphone, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function ShopifyDailyPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: dailySummary = [] } = useQuery({
    queryKey: ["shopifyDaily", dateRange],
    queryFn: () => getShopifyDailySummary(dateRange),
  });

  const { data: metaAd = { total_spend: 0, total_purchases: 0, total_purchase_value: 0, total_impressions: 0, total_clicks: 0 } } = useQuery({
    queryKey: ["metaAdSummary", dateRange],
    queryFn: () => getMetaAdSummary(dateRange),
  });

  const totalSales = (dailySummary as any[]).reduce((s: number, d: any) => s + (d.net_sales || 0), 0);
  const totalOrders = (dailySummary as any[]).reduce((s: number, d: any) => s + (d.total_orders || 0), 0);
  const totalUnits = (dailySummary as any[]).reduce((s: number, d: any) => s + (d.total_units || 0), 0);
  const adSpend = metaAd?.total_spend || 0;
  const profit = totalSales - adSpend; // 簡易利益（原価は商品別で計算）

  const chartData = (dailySummary as any[]).map((d: any) => ({
    date: d.date.slice(5),
    売上: d.net_sales || 0,
    注文数: d.total_orders || 0,
  }));

  return (
    <div>
      <PageHeader title="【Shopify】日別分析" description="feela.co.jp の日別売上">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
        <KPICard title="販売個数" value={formatNumber(totalUnits)} icon={ShoppingCart} />
        <KPICard title="Meta広告費" value={formatCurrency(adSpend)} icon={Megaphone} />
        <KPICard title="ROAS" value={adSpend > 0 ? formatPercent((totalSales / adSpend) * 100) : "-"} icon={TrendingUp} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="売上" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">割引額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dailySummary as any[]).slice().reverse().map((d: any) => (
                <TableRow key={d.date}>
                  <TableCell>{d.date}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(d.net_sales || 0)}</TableCell>
                  <TableCell className="text-right">{formatNumber(d.total_orders)}</TableCell>
                  <TableCell className="text-right">{formatNumber(d.total_units)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--muted-foreground))]">{formatCurrency(d.total_discounts || 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
