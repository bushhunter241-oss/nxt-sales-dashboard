"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, formatDate, getDateRange } from "@/lib/utils";
import { getRakutenDailySales, getRakutenDailyAdSpendByDate } from "@/lib/api/rakuten-sales";
import { getRakutenProducts } from "@/lib/api/rakuten-products";
import { DollarSign, TrendingUp, ShoppingCart, BarChart3, Wallet, Eye } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

interface DailyAggregated {
  date: string;
  sales_amount: number;
  orders: number;
  access_count: number;
  units_sold: number;
  cost: number;
  fee: number;
  shipping_fee: number;
  ad_spend: number;
  profit: number;
  profit_rate: number;
}

export default function RakutenDailyPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);

  const { data: salesData = [] } = useQuery({
    queryKey: ["rakutenDailySales", dateRange],
    queryFn: () => getRakutenDailySales(dateRange),
  });

  const { data: adSpendByDate = {} } = useQuery({
    queryKey: ["rakutenDailyAdSpend", dateRange],
    queryFn: () => getRakutenDailyAdSpendByDate(dateRange),
  });

  // All rakuten products for parent fallback
  const { data: allProducts = [] } = useQuery({
    queryKey: ["rakutenProductsAll"],
    queryFn: () => getRakutenProducts(true),
  });

  // Build parent lookup: product_id → product data
  const parentLookup = useMemo(() => {
    const byProductId = new Map<string, any>();
    for (const p of allProducts as any[]) {
      if (p.product_id) byProductId.set(p.product_id, p);
    }
    return byProductId;
  }, [allProducts]);

  // Resolve cost/fee/shipping with parent fallback
  const resolveProductCosts = (product: any) => {
    let costPrice = product?.cost_price || 0;
    let feeRate = product?.fee_rate || 0;
    let shippingFee = product?.shipping_fee || 0;

    // If any value is 0 and product has a parent, try parent's values
    if (product?.parent_product_id && (costPrice === 0 || feeRate === 0 || shippingFee === 0)) {
      const parent = parentLookup.get(product.parent_product_id);
      if (parent) {
        if (costPrice === 0) costPrice = parent.cost_price || 0;
        if (feeRate === 0) feeRate = parent.fee_rate || 0;
        if (shippingFee === 0) shippingFee = parent.shipping_fee || 0;
      }
    }

    // Default fee_rate fallback
    if (feeRate === 0) feeRate = 10;

    return { costPrice, feeRate, shippingFee };
  };

  const aggregated = (salesData as any[]).reduce((acc: Record<string, DailyAggregated>, row: any) => {
    const d = row.date;
    if (!acc[d]) {
      acc[d] = { date: d, sales_amount: 0, orders: 0, access_count: 0, units_sold: 0, cost: 0, fee: 0, shipping_fee: 0, ad_spend: 0, profit: 0, profit_rate: 0 };
    }
    acc[d].sales_amount += row.sales_amount || 0;
    acc[d].orders += row.orders || 0;
    acc[d].access_count += row.access_count || 0;
    acc[d].units_sold += row.units_sold || 0;

    const product = row.rakuten_product;
    if (product) {
      const { costPrice, feeRate, shippingFee } = resolveProductCosts(product);
      const units = row.units_sold || 0;
      acc[d].cost += costPrice * units;
      acc[d].fee += Math.round((row.sales_amount || 0) * (feeRate / 100));
      acc[d].shipping_fee += shippingFee * units;
    }
    return acc;
  }, {} as Record<string, DailyAggregated>);

  const dailyData: DailyAggregated[] = Object.values(aggregated)
    .map((day) => {
      const adSpend = (adSpendByDate as Record<string, number>)[day.date] || 0;
      const profit = day.sales_amount - day.cost - day.fee - day.shipping_fee - adSpend;
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
  const totalAccess = dailyData.reduce((s, d) => s + d.access_count, 0);
  const avgProfitRate = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  return (
    <div>
      <PageHeader title="【楽天】日別分析" description="楽天市場の日別売上・利益推移">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KPICard title="売上合計" value={formatCurrency(totalSales)} icon={DollarSign} />
        <KPICard title="利益合計" value={formatCurrency(totalProfit)} icon={Wallet} />
        <KPICard title="利益率" value={formatPercent(avgProfitRate)} icon={TrendingUp} />
        <KPICard title="広告費" value={formatCurrency(totalAdSpend)} icon={BarChart3} />
        <KPICard title="アクセス数" value={formatNumber(totalAccess)} icon={Eye} />
        <KPICard title="注文件数" value={formatNumber(totalOrders)} icon={ShoppingCart} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>売上・利益推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: number, name: string) => [formatCurrency(value), name]} />
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
                <TableHead className="text-right">楽天手数料</TableHead>
                <TableHead className="text-right">送料</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">注文</TableHead>
                <TableHead className="text-right">アクセス</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyData.map((day, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(day.date)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(day.sales_amount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.cost)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.fee)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.shipping_fee)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(day.ad_spend)}</TableCell>
                  <TableCell className={`text-right font-medium ${day.profit >= 0 ? "text-green-500" : "text-red-500"}`}>{formatCurrency(day.profit)}</TableCell>
                  <TableCell className={`text-right ${day.profit_rate >= 0 ? "text-green-500" : "text-red-500"}`}>{formatPercent(day.profit_rate)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.orders)}</TableCell>
                  <TableCell className="text-right">{formatNumber(day.access_count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
