"use client";
import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/layout/period-filter";
import { KPICard } from "@/components/layout/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, formatNumber, getDateRange } from "@/lib/utils";
import { getRakutenDailyAdvertising, getRakutenAdSummary } from "@/lib/api/rakuten-advertising";
import { getRakutenProductSalesSummary } from "@/lib/api/rakuten-sales";
import { Megaphone, DollarSign, MousePointerClick, TrendingUp, Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";

const RAKUTEN_RED = "#bf0000";

function CsvUploadArea({ onSuccess }: { onSuccess: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/rakuten/advertising", { method: "POST", body: formData });
      const json = await res.json();
      setResult({ ok: json.success, message: json.message });
      if (json.success) onSuccess();
    } catch (e) {
      setResult({ ok: false, message: "アップロードに失敗しました" });
    } finally {
      setUploading(false);
    }
  }, [onSuccess]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) handleFile(file);
    else setResult({ ok: false, message: "CSVファイルをドロップしてください" });
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => fileRef.current?.click()}
      className={`relative cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
        dragOver
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]"
          : "border-[hsl(0_0%_25%)] hover:border-[hsl(0_0%_40%)]"
      }`}
    >
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileSelect} />
      {uploading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-[hsl(0_0%_60%)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>アップロード中...</span>
        </div>
      ) : result ? (
        <div className={`flex items-center justify-center gap-2 text-sm ${result.ok ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>
          {result.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{result.message}</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-[hsl(0_0%_60%)]">
          <Upload className="h-4 w-4" />
          <span>RPPレポートCSVをドラッグ＆ドロップ（またはクリックして選択）</span>
        </div>
      )}
    </div>
  );
}

export default function RakutenRppPage() {
  const [period, setPeriod] = useState("30days");
  const dateRange = getDateRange(period);
  const queryClient = useQueryClient();

  const { data: adData = [] } = useQuery({
    queryKey: ["rakutenAdvertising", dateRange],
    queryFn: () => getRakutenDailyAdvertising(dateRange),
  });

  const { data: adSummary } = useQuery({
    queryKey: ["rakutenAdSummary", dateRange],
    queryFn: () => getRakutenAdSummary(dateRange),
  });

  const { data: productSummary = [] } = useQuery({
    queryKey: ["rakutenProductSummary", dateRange],
    queryFn: () => getRakutenProductSalesSummary(dateRange),
  });

  const totalSales = (productSummary as any[]).reduce((s: number, p: any) => s + p.total_sales, 0);
  const totalAdSpend = adSummary?.total_ad_spend || 0;
  const totalAdSales = adSummary?.total_ad_sales || 0;
  const totalClicks = adSummary?.total_clicks || 0;
  const totalImpressions = adSummary?.total_impressions || 0;
  const avgAcos = totalAdSales > 0 ? (totalAdSpend / totalAdSales) * 100 : 0;
  const roas = totalAdSpend > 0 ? totalAdSales / totalAdSpend : 0;
  const tacos = totalSales > 0 ? (totalAdSpend / totalSales) * 100 : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const dailyAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const d = row.date;
    if (!acc[d]) acc[d] = { date: d, ad_spend: 0, ad_sales: 0, clicks: 0, impressions: 0 };
    acc[d].ad_spend += row.ad_spend;
    acc[d].ad_sales += row.ad_sales;
    acc[d].clicks += row.clicks;
    acc[d].impressions += row.impressions;
    return acc;
  }, {});

  const chartData = Object.values(dailyAgg)
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .map((d: any) => ({
      date: d.date.slice(5),
      RPP広告費: d.ad_spend,
      RPP広告売上: d.ad_sales,
      ACOS: d.ad_sales > 0 ? ((d.ad_spend / d.ad_sales) * 100).toFixed(1) : 0,
    }));

  const productAgg = (adData as any[]).reduce((acc: Record<string, any>, row: any) => {
    const pid = row.product_id;
    if (!acc[pid]) acc[pid] = { product: row.rakuten_product, ad_spend: 0, ad_sales: 0, clicks: 0, impressions: 0 };
    acc[pid].ad_spend += row.ad_spend;
    acc[pid].ad_sales += row.ad_sales;
    acc[pid].clicks += row.clicks;
    acc[pid].impressions += row.impressions;
    return acc;
  }, {});

  const productAdData = Object.values(productAgg).sort((a: any, b: any) => b.ad_spend - a.ad_spend);

  return (
    <div>
      <PageHeader title="🔴 楽天 RPP広告管理" description="RPP広告パフォーマンス分析">
        <PeriodFilter value={period} onChange={setPeriod} />
      </PageHeader>

      <CsvUploadArea onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ["rakutenAdvertising"] });
        queryClient.invalidateQueries({ queryKey: ["rakutenAdSummary"] });
      }} />

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <KPICard title="RPP広告費" value={formatCurrency(totalAdSpend)} icon={Megaphone} />
        <KPICard title="RPP広告売上" value={formatCurrency(totalAdSales)} icon={DollarSign} />
        <KPICard title="ACOS" value={formatPercent(avgAcos)} icon={TrendingUp} valueClassName={avgAcos < 30 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"} />
        <KPICard title="ROAS" value={`${roas.toFixed(2)}x`} icon={TrendingUp} valueClassName={roas > 3 ? "text-[hsl(var(--success))]" : ""} />
        <KPICard title="TACoS" value={formatPercent(tacos)} icon={TrendingUp} valueClassName={tacos < 10 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"} />
        <KPICard title="CTR" value={formatPercent(ctr)} icon={MousePointerClick} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>RPP広告費・売上推移</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
              <XAxis dataKey="date" stroke="hsl(0 0% 50%)" fontSize={12} />
              <YAxis yAxisId="left" stroke="hsl(0 0% 50%)" fontSize={12} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(0 0% 50%)" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", borderRadius: "8px" }} />
              <Legend />
              <Bar yAxisId="left" dataKey="RPP広告費" fill={RAKUTEN_RED} radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="RPP広告売上" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="ACOS" stroke="#f97316" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>商品別RPP広告データ</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">広告費</TableHead>
                <TableHead className="text-right">広告売上</TableHead>
                <TableHead className="text-right">ACOS</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">クリック</TableHead>
                <TableHead className="text-right">インプレッション</TableHead>
                <TableHead className="text-right">CTR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productAdData.map((p: any, i: number) => {
                const acos = p.ad_sales > 0 ? (p.ad_spend / p.ad_sales) * 100 : 0;
                const prodRoas = p.ad_spend > 0 ? p.ad_sales / p.ad_spend : 0;
                const prodCtr = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.product?.name || "不明"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.ad_spend)}</TableCell>
                    <TableCell className="text-right text-red-500">{formatCurrency(p.ad_sales)}</TableCell>
                    <TableCell className={`text-right ${acos < 30 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}`}>{formatPercent(acos)}</TableCell>
                    <TableCell className="text-right">{prodRoas.toFixed(2)}x</TableCell>
                    <TableCell className="text-right">{formatNumber(p.clicks)}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.impressions)}</TableCell>
                    <TableCell className="text-right">{formatPercent(prodCtr)}</TableCell>
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
