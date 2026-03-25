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
import { getDailyAdSpendByDateCampaignLevel } from "@/lib/api/advertising";
import { DollarSign, TrendingUp, ShoppingCart, BarChart3, Wallet } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

interface DailyAggregated {
  date: string;
  sales_amount: number;
  orders: number;
  sessions: number;
  units_sold: number;
  cost: number;
  fba_fee: number;
  ad_spend: number;
  profit: number;
  profit_rate: number;
}

export default function DailyAnalysisPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: salesData = [] } = useQuery({
    queryKey: ["dailySales", dateRange],
    queryFn: () => getDailySales(dateRange),
  });

  const { data: adSpendByDate = {} } = useQuery({
    queryKey: ["dailyAdSpendCampaign", dateRange],
    queryFn: () => getDailyAdSpendByDateCampaignLevel(dateRange),
  });

  // Aggregate by date with profit calculation
  const aggregated = (salesData as any[]).reduce((acc: Record<string, DailyAggregated>, row: any) => {
    const d = row.date;
    if (!acc[d]) {
      acc[d] = { date: d, sales_amount: 0, orders: 0, sessions: 0, units_sold: 0, cost: 0, fba_fee: 0, ad_spend: 0, profit: 0, profit_rate: 0 };
    }
    acc[d].sales_amount += row.sales_amount;
    acc[d].orders += row.orders;
    acc[d].sessions += row.sessions;
    acc[d].units_sold += row.units_sold;

    // Per-product cost and FBA fee calculation
    const product = row.product;
    if (product) {
      const costPrice = product.cost_price || 0;
      const fbaFeeRate = product.fba_fee_rate || 15;
      const fbaShippingFee = product.fba_shipping_fee || 0;
      const units = row.units_sold || 0;
      acc[d].cost += costPrice * units;
      acc[d].fba_fee += Math.round(row.sales_amount * (fbaFeeRate / 100)) + fbaShippingFee * units;
    }

    return acc;
  }, {} as Record<string, DailyAggregated>);

  // Add ad spend and calculate profit
  const dailyData: DailyAggregated[] = Object.values(aggregated)
    .map((day) => {
      const adSpend = (adSpendByDate as Record<string, number>)[day.date] || 0;
      const profit = day.sales_amount - day.cost - day.fba_fee - adSpend;
      const profitRate = day.sales_amount > 0 ? (profit / day.sales_amount) * 100 : 0;
      return { ...day, ad_spend: adSpend, profit, profit_rate: profitRate };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const chartData = [...dailyData].reverse().map((d) => ({
    date: d.date.slice(5),
    売上: d.sales_amount,
    利益: d.profit,
    広告費: d.ad_spend,
  }));

  const totalSales = dailyData.reduce((s, d) => s + d.sales_amount, 0);
  const totalOrders = dailyData.reduce((s, d) => s + d.orders, 0);
  const totalProfit = dailyData.reduce((s, d) => s + d.profit, 0);
  const totalAdSpend = dailyData.reduce((s, d) => s + d.ad_spend, 0);
  const totalSessions = dailyData.reduce((s, d) => s + d.sessions, 0);
  const avgProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  return (
    <div>
      <PageHeader title="日別分析" description="日別の売上・利益推移">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={Wallet} />
        <KPICard title="利益率" value={formatPercent(avgProfitRate)} icon={TrendingUp} />
        <KPICard title="広告費" value={formatCurrency(totalAdSpend)} icon={BarChart3} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>売上・利益推移</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(0 0% 30%)" />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="利益" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="広告費" stroke={CHART_COLORS[4]} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
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
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">原価</TableHead>
                <TableHead className="text-right">FBA手数料</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">注文</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyData.map((day, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(day.date)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(day.sales_amount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.cost)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.fba_fee)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.ad_spend)}</TableCell>
                  <TableCell className={`text-right font-medium ${day.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(day.profit)}
                  </TableCell>
                  <TableCell className={`text-right ${day.profit_rate >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatPercent(day.profit_rate)}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(day.orders)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
