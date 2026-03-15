"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { getAggregatedRakutenDailySales } from "@/lib/api/rakuten-sales";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const RAKUTEN_RED = "#bf0000";

export default function RakutenMonthlyPage() {
  const { data: allSales = [] } = useQuery({
    queryKey: ["rakutenAllSales"],
    queryFn: () => getAggregatedRakutenDailySales({}),
  });

  // Group by month
  const monthlyMap = (allSales as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = { month, sales_amount: 0, orders: 0, access_count: 0, units_sold: 0 };
    acc[month].sales_amount += row.sales_amount;
    acc[month].orders += row.orders;
    acc[month].access_count += row.access_count;
    acc[month].units_sold += row.units_sold;
    return acc;
  }, {});

  const monthlyData = Object.values(monthlyMap)
    .sort((a: any, b: any) => a.month.localeCompare(b.month))
    .slice(-12);

  const chartData = monthlyData.map((m: any) => ({
    month: m.month.slice(5) + "月",
    売上: m.sales_amount,
    注文数: m.orders,
  }));

  return (
    <div>
      <PageHeader title="🔴 楽天 月別分析" description="楽天市場の月別売上推移（最新12ヶ月）" />

      <Card>
        <CardHeader><CardTitle>月別売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="month" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }}
                formatter={(value: any) => formatCurrency(value)}
              />
              <Legend />
              <Bar dataKey="売上" fill={RAKUTEN_RED} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">アクセス</TableHead>
                <TableHead className="text-right">CVR</TableHead>
                <TableHead className="text-right">前月比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...monthlyData].reverse().map((m: any, i: number, arr: any[]) => {
                const prev = arr[i + 1];
                const mom = prev && prev.sales_amount > 0
                  ? ((m.sales_amount - prev.sales_amount) / prev.sales_amount) * 100
                  : null;
                const cvr = m.access_count > 0 ? (m.orders / m.access_count) * 100 : 0;
                const [y, mo] = m.month.split("-");
                return (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{y}年{Number(mo)}月</TableCell>
                    <TableCell className="text-right text-red-500">{formatCurrency(m.sales_amount)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.orders)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.units_sold)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.access_count)}</TableCell>
                    <TableCell className="text-right">{formatPercent(cvr)}</TableCell>
                    <TableCell className={`text-right ${mom !== null ? (mom >= 0 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]") : ""}`}>
                      {mom !== null ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "-"}
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
