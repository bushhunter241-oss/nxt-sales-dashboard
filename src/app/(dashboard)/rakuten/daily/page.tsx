"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, formatDate, getDateRange } from "@/lib/utils";
import { getRakutenDailySales } from "@/lib/api/rakuten-sales";
import { DollarSign, TrendingUp, ShoppingCart, BarChart3 } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";

const RAKUTEN_RED = "#bf0000";

export default function RakutenDailyPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: salesData = [] } = useQuery({
    queryKey: ["rakutenDailySales", dateRange],
    queryFn: () => getRakutenDailySales(dateRange),
  });

  const aggregated = (salesData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const d = row.date;
    if (!acc[d]) acc[d] = { date: d, sales_amount: 0, orders: 0, access_count: 0, units_sold: 0 };
    acc[d].sales_amount += row.sales_amount;
    acc[d].orders += row.orders;
    acc[d].access_count += row.access_count;
    acc[d].units_sold += row.units_sold;
    return acc;
  }, {});

  const dailyData = Object.values(aggregated).sort((a: any, b: any) => b.date.localeCompare(a.date));
  const chartData = [...dailyData].reverse().map((d: any) => ({
    date: d.date.slice(5),
    売上: d.sales_amount,
    アクセス: d.access_count,
  }));

  const totalSales = dailyData.reduce((s: number, d: any) => s + d.sales_amount, 0);
  const totalOrders = dailyData.reduce((s: number, d: any) => s + d.orders, 0);
  const totalAccess = dailyData.reduce((s: number, d: any) => s + d.access_count, 0);
  const avgCvr = totalAccess > 0 ? (totalOrders / totalAccess) * 100 : 0;

  return (
    <div>
      <PageHeader title="🔴 楽天 日別分析" description="楽天市場の日別売上・アクセス推移">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
        <KPICard title="アクセス" value={formatNumber(totalAccess)} icon={BarChart3} />
        <KPICard title="CVR" value={formatPercent(avgCvr)} icon={TrendingUp} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>売上・アクセス推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 50%)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
              <Legend />
              <Bar yAxisId="left" dataKey="売上" fill={RAKUTEN_RED} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="アクセス" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead className="text-right">注文件数</TableHead>
                <TableHead className="text-right">売上合計</TableHead>
                <TableHead className="text-right">アクセス</TableHead>
                <TableHead className="text-right">CVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyData.map((day: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(day.date)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.orders)}</TableCell>
                  <TableCell className="text-right text-red-500">{formatCurrency(day.sales_amount)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.access_count)}</TableCell>
                  <TableCell className="text-right">{day.access_count > 0 ? formatPercent((day.orders / day.access_count) * 100) : "0%"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
