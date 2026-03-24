"use client";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { getShopifyDailySummary } from "@/lib/api/shopify-sales";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function ShopifyMonthlyPage() {
  const { data: allData = [] } = useQuery({
    queryKey: ["shopifyDailyAll"],
    queryFn: () => getShopifyDailySummary({}),
  });

  const monthly = (allData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const month = row.date.slice(0, 7);
    if (!acc[month]) acc[month] = { month, net_sales: 0, total_orders: 0, total_units: 0, total_discounts: 0 };
    acc[month].net_sales += row.net_sales || 0;
    acc[month].total_orders += row.total_orders || 0;
    acc[month].total_units += row.total_units || 0;
    acc[month].total_discounts += row.total_discounts || 0;
    return acc;
  }, {});

  const monthlyData = Object.values(monthly).sort((a: any, b: any) => b.month.localeCompare(a.month));
  const chartData = [...monthlyData].reverse().slice(-12).map((d: any) => ({
    month: d.month.slice(2),
    売上: d.net_sales,
  }));

  return (
    <div>
      <PageHeader title="【Shopify】月別分析" description="feela.co.jp の月別売上推移" />

      <Card>
        <CardHeader><CardTitle>月別売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="month" stroke="hsl(0 0% 50%)" fontSize={12} />
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
                <TableHead>月</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">割引額</TableHead>
                <TableHead className="text-right">前月比</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlyData.map((m: any, i: number) => {
                const prev = monthlyData[i + 1] as any;
                const change = prev ? ((m.net_sales - prev.net_sales) / prev.net_sales) * 100 : 0;
                return (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{m.month}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(m.net_sales)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.total_orders)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.total_units)}</TableCell>
                    <TableCell className="text-right text-[hsl(var(--muted-foreground))]">{formatCurrency(m.total_discounts)}</TableCell>
                    <TableCell className={`text-right ${change >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {prev ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "-"}
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
