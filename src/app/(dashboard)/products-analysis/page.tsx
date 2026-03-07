"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getProductSalesSummary, getDailySales } from "@/lib/api/sales";
import { getProducts } from "@/lib/api/products";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { CHART_COLORS } from "@/lib/constants";

export default function ProductAnalysisPage() {
  const [period, setPeriod] = useState("30days");
  const [selectedProduct, setSelectedProduct] = useState("");
  const dateRange = getDateRange(period);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["productSummary", dateRange],
    queryFn: () => getProductSalesSummary(dateRange),
  });

  const { data: productDailySales = [] } = useQuery({
    queryKey: ["productDailySales", dateRange, selectedProduct],
    queryFn: () => getDailySales({ ...dateRange, productId: selectedProduct || undefined }),
    enabled: !!selectedProduct,
  });

  const pieData = (productSummary as any[])
    .sort((a: any, b: any) => b.total_sales - a.total_sales)
    .map((p: any, i: number) => ({
      name: p.product?.name || "不明",
      value: p.total_sales,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

  const productOptions = [
    { value: "", label: "商品を選択" },
    ...(products as any[]).map((p: any) => ({ value: p.id, label: p.name })),
  ];

  const selectedProductData = selectedProduct
    ? [...(productDailySales as any[])].reverse().map((d: any) => ({
        date: d.date.slice(5),
        売上: d.sales_amount,
        注文数: d.orders,
      }))
    : [];

  return (
    <div>
      <PageHeader title="商品別分析" description="商品ごとの売上分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>売上構成比</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>商品別売上比較</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={pieData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis type="number" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <YAxis type="category" dataKey="name" stroke="hsl(0 0% 50%)" fontSize={11} width={100} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} formatter={(value: any) => formatCurrency(value)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {pieData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>商品別推移</CardTitle>
          <Select options={productOptions} value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} className="w-48" />
        </CardHeader>
        <CardContent>
          {selectedProduct && selectedProductData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={selectedProductData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
                <YAxis stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
                <Bar dataKey="売上" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-48 items-center justify-center text-[hsl(var(--muted-foreground))]">
              商品を選択してください
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">注文数</TableHead>
                <TableHead className="text-right">販売個数</TableHead>
                <TableHead className="text-right">セッション</TableHead>
                <TableHead className="text-right">CVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(productSummary as any[]).sort((a: any, b: any) => b.total_sales - a.total_sales).map((p: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{p.product?.name || "不明"}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--primary))]">{formatCurrency(p.total_sales)}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.total_orders)}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.total_units)}</TableCell>
                  <TableCell className="text-right">{formatNumber(p.total_sessions)}</TableCell>
                  <TableCell className="text-right">{p.total_sessions > 0 ? formatPercent((p.total_orders / p.total_sessions) * 100) : "0%"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
