"use client";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getProducts } from "@/lib/api/products";
import { upsertDailySales } from "@/lib/api/sales";
import { upsertDailyAdvertising } from "@/lib/api/advertising";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import Papa from "papaparse";

type ImportType = "business" | "advertising";

export default function ImportPage() {
  const [importType, setImportType] = useState<ImportType>("business");
  const [reportDate, setReportDate] = useState(new Date().toISOString().split("T")[0]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const queryClient = useQueryClient();

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".csv") || f.name.endsWith(".txt"))) setFile(f);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setStatus(null);

    try {
      const text = await file.text();
      const { data: rows } = Papa.parse(text, { header: true, skipEmptyLines: true });
      let imported = 0;

      if (importType === "business") {
        for (const row of rows as any[]) {
          const asin = row["(子)ASIN"] || row["ASIN"] || row["asin"] || "";
          const product = (products as any[]).find((p: any) => p.asin === asin);
          if (!product) continue;
          
          await upsertDailySales({
            product_id: product.id,
            date: reportDate,
            sessions: parseInt(row["セッション - 合計"] || row["sessions"] || "0") || 0,
            orders: parseInt(row["注文された商品点数"] || row["units_ordered"] || "0") || 0,
            sales_amount: Math.round(parseFloat(row["注文商品売上"] || row["ordered_product_sales"] || "0") || 0),
            units_sold: parseInt(row["注文された商品点数"] || row["units_ordered"] || "0") || 0,
            cvr: parseFloat(row["セッションのパーセンテージ - 注文商品点数"] || "0") || 0,
            cancellations: 0,
          });
          imported++;
        }
      } else {
        for (const row of rows as any[]) {
          const asin = row["広告された ASIN"] || row["Advertised ASIN"] || "";
          const product = (products as any[]).find((p: any) => p.asin === asin);
          if (!product) continue;

          await upsertDailyAdvertising({
            product_id: product.id,
            date: row["日付"] || row["Date"] || reportDate,
            ad_spend: Math.round(parseFloat(row["費用"] || row["Spend"] || "0") || 0),
            ad_sales: Math.round(parseFloat(row["7日間の総売上高"] || row["7 Day Total Sales"] || "0") || 0),
            impressions: parseInt(row["インプレッション"] || row["Impressions"] || "0") || 0,
            clicks: parseInt(row["クリック"] || row["Clicks"] || "0") || 0,
            acos: parseFloat(row["ACOS"] || "0") || 0,
            roas: parseFloat(row["ROAS"] || "0") || 0,
            campaign_name: row["キャンペーン名"] || row["Campaign Name"] || null,
            campaign_type: "sp",
          });
          imported++;
        }
      }

      queryClient.invalidateQueries();
      setStatus({ type: "success", message: `${imported}件のデータをインポートしました` });
      setFile(null);
    } catch (err: any) {
      setStatus({ type: "error", message: `エラー: ${err.message}` });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <PageHeader title="CSVインポート" description="AmazonセラーセントラルからダウンロードしたCSVファイルをインポートします" />

      <div className="flex gap-2 mb-6">
        <Button variant={importType === "business" ? "default" : "outline"} onClick={() => setImportType("business")}>ビジネスレポート</Button>
        <Button variant={importType === "advertising" ? "default" : "outline"} onClick={() => setImportType("advertising")}>広告レポート</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{importType === "business" ? "ビジネスレポート" : "広告レポート"}のインポート</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">レポート日付</label>
              <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-48" />
            </div>
          </div>

          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[hsl(var(--border))] p-12 transition-colors hover:border-[hsl(var(--primary))]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
          >
            <Upload className="mb-4 h-10 w-10 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">CSVファイルをドロップ</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">またはクリックしてファイルを選択</p>
            <input type="file" accept=".csv,.txt" onChange={handleFileChange} className="absolute inset-0 cursor-pointer opacity-0" style={{ position: "relative", marginTop: "8px" }} />
          </div>

          {file && (
            <div className="flex items-center justify-between rounded-lg bg-[hsl(var(--muted))] p-3">
              <span className="text-sm">{file.name}</span>
              <Button onClick={handleImport} disabled={importing}>{importing ? "インポート中..." : "インポート実行"}</Button>
            </div>
          )}

          {status && (
            <div className={`flex items-center gap-2 rounded-lg p-3 ${status.type === "success" ? "bg-green-900/20 text-[hsl(var(--success))]" : "bg-red-900/20 text-[hsl(var(--destructive))]"}`}>
              {status.type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
              {status.message}
            </div>
          )}

          <Card className="bg-[hsl(var(--muted))]">
            <CardContent className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
              <p className="font-medium mb-2">対応レポート形式:</p>
              <p><strong>ビジネスレポート:</strong> セラーセントラル → レポート → ビジネスレポート → 詳細ページ 売上・トラフィック（子ASIN別）</p>
              <p><strong>広告レポート:</strong> セラーセントラル → 広告 → 広告レポート → スポンサープロダクト</p>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
