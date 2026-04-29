"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { getRakutenDailySales, getRakutenDailyAdSpendByDate, getRakutenDailyProfitBreakdown } from "@/lib/api/rakuten-sales";
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function RakutenMonthlyPage() {
  const { data: salesData = [] } = useQuery({
    queryKey: ["rakutenAllSales"],
    queryFn: () => getRakutenDailySales({}),
  });

  const { data: adSpendByDate = {} } = useQuery({
    queryKey: ["rakutenAllAdSpend"],
    queryFn: () => getRakutenDailyAdSpendByDate({}),
  });

  const { data: profitByDate = {} } = useQuery({
    queryKey: ["rakutenAllProfitBreakdown"],
    queryFn: () => getRakutenDailyProfitBreakdown({}),
  });

  // 月別に集計（売上・注文・アクセス・個数）
  const monthly = (salesData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7);
    if (!acc[month]) acc[month] = { month, sales_amount: 0, orders: 0, access_count: 0, units_sold: 0 };
    acc[month].sales_amount += row.sales_amount || 0;
    acc[month].orders += row.orders || 0;
    acc[month].access_count += row.access_count || 0;
    acc[month].units_sold += row.units_sold || 0;
    return acc;
  }, {});

  // 月別広告費・利益を集計（日別データから）
  for (const [date, profit] of Object.entries(profitByDate as Record<string, { profit: number }>)) {
    const month = date.slice(0, 7);
    if (monthly[month]) {
      monthly[month].profit = (monthly[month].profit || 0) + profit.profit;
    }
  }
  for (const [date, adSpend] of Object.entries(adSpendByDate as Record<string, number>)) {
    const month = date.slice(0, 7);
    if (monthly[month]) {
      monthly[month].ad_spend = (monthly[month].ad_spend || 0) + adSpend;
    }
  }

  const now = new Date();
  const cutoff = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyData = Object.values(monthly)
    .filter((m: any) => m.month >= cutoff)
    .sort((a: any, b: any) => b.month.localeCompare(a.month))
    .map((m: any) => ({
      ...m,
      profit: m.profit || 0,
      ad_spend: m.ad_spend || 0,
      profit_rate: m.sales_amount > 0 ? ((m.profit || 0) / m.sales_amount) * 100 : 0,
    }));

  const chartData = [...monthlyData].reverse().slice(-12).map((d: any) => ({
    month: d.month.slice(2),
    売上: d.sales_amount,
    利益: d.profit,
    広告費: d.ad_spend,
  }));

  return (
    <div>
      <PageHeader title="【楽天】月別分析" description="楽天市場の月別売上推移" />

      <Card>
        <CardHeader><CardTitle>月別売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="month" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(0 0% 30%)" />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="広告費" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="利益" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上合計</TableHead>
                <TableHead className="text-right">注文件数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">アクセス数</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">利益</TableHead>
                <TableHead className="text-right">利益率</TableHead>
                <TableHead className="text-right">前月比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlyData.map((m: any, i: number) => {
                const prev = monthlyData[i + 1];
                const momChange = prev ? ((m.sales_amount - prev.sales_amount) / prev.sales_amount) * 100 : 0;
                return (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{m.month}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(m.sales_amount)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.orders)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.units_sold)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.access_count)}</TableCell>
                    <TableCell className="text-right">{m.access_count > 0 ? formatPercent((m.orders / m.access_count) * 100) : "-"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.ad_spend > 0 ? formatCurrency(m.ad_spend) : "-"}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${m.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatCurrency(m.profit)}
                    </TableCell>
                    <TableCell className={`text-right ${m.profit_rate >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatPercent(m.profit_rate)}
                    </TableCell>
                    <TableCell className={`text-right ${momChange >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]"}`}>
                      {prev ? `${momChange >= 0 ? "+" : ""}${momChange.toFixed(1)}%` : "-"}
                    </TableCell>
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
