"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, formatDate, getDateRange } from "@/lib/utils";
import { getDailySales } from "@/lib/api/sales";
import { getAdSummary } from "@/lib/api/advertising";
import { DollarSign, TrendingUp, ShoppingCart, BarChart3 } from "lucide-react";
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function DailyAnalysisPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: salesData = [] } = useQuery({
    queryKey: ["dailySales", dateRange],
    queryFn: () => getDailySales(dateRange),
  });

  const { data: adSummary } = useQuery({
    queryKey: ["adSummary", dateRange],
    queryFn: () => getAdSummary(dateRange),
  });

  // Aggregate by date
  const aggregated = (salesData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const d = row.date;
    if (!acc[d]) acc[d] = { date: d, sales_amount: 0, orders: 0, sessions: 0, units_sold: 0 };
    acc[d].sales_amount += row.sales_amount;
    acc[d].orders += row.orders;
    acc[d].sessions += row.sessions;
    acc[d].units_sold += row.units_sold;
    return acc;
  }, {});

  const dailyData = Object.values(aggregated).sort((a: any, b: any) => b.date.localeCompare(a.date));
  const chartData = [...dailyData].reverse().map((d: any) => ({
    date: d.date.slice(5),
    売上: d.sales_amount,
    セッション: d.sessions,
  }));

  const totalSales = dailyData.reduce((s: number, d: any) => s + d.sales_amount, 0);
  const totalOrders = dailyData.reduce((s: number, d: any) => s + d.orders, 0);
  const totalSessions = dailyData.reduce((s: number, d: any) => s + d.sessions, 0);
  const avgCvr = totalSessions > 0 ? (totalOrders / totalSessions) * 100 : 0;

  return (
    <div>
      <PageHeader title="日別分析" description="日別の売上・利益推移">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
        <KPICard title="セッション" value={formatNumber(totalSessions)} icon={BarChart3} />
        <KPICard title="CVR" value={formatPercent(avgCvr)} icon={TrendingUp} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>売上・セッション推移</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 50%)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
              <Legend />
              <Bar yAxisId="left" dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="セッション" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
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
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyData.map((day: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(day.date)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.orders)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(day.sales_amount)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.sessions)}</TableCell>
                  <TableCell className="text-right">{day.sessions > 0 ? formatPercent((day.orders / day.sessions) * 100) : "0%"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
