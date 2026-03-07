"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { getDailySales } from "@/lib/api/sales";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function MonthlyAnalysisPage() {
  const { data: salesData = [] } = useQuery({
    queryKey: ["allSales"],
    queryFn: () => getDailySales({}),
  });

  // Aggregate by month
  const monthly = (salesData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7);
    if (!acc[month]) acc[month] = { month, sales_amount: 0, orders: 0, sessions: 0, units_sold: 0 };
    acc[month].sales_amount += row.sales_amount;
    acc[month].orders += row.orders;
    acc[month].sessions += row.sessions;
    acc[month].units_sold += row.units_sold;
    return acc;
  }, {});

  const monthlyData = Object.values(monthly).sort((a: any, b: any) => b.month.localeCompare(a.month));
  const chartData = [...monthlyData].reverse().slice(-12).map((d: any) => ({
    month: d.month.slice(2),
    売上: d.sales_amount,
    注文数: d.orders,
  }));

  return (
    <div>
      <PageHeader title="月別分析" description="月別の売上推移" />

      <Card>
        <CardHeader>
          <CardTitle>月別売上推移</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="month" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
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
                <TableHead className="text-right">売上合計</TableHead>
                <TableHead className="text-right">注文件数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
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
                    <TableCell className="text-right">{formatNumber(m.sessions)}</TableCell>
                    <TableCell className="text-right">{m.sessions > 0 ? formatPercent((m.orders / m.sessions) * 100) : "0%"}</TableCell>
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
