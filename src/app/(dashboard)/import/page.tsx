"use client";
import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getProducts } from "@/lib/api/products";
import { getRakutenProducts } from "@/lib/api/rakuten-products";
import { upsertDailySales } from "@/lib/api/sales";
import { upsertDailyAdvertising } from "@/lib/api/advertising";
import { updateRakutenAccessData, importRakutenSalesCSV } from "@/lib/api/rakuten-sales";
import { parseMonthlySummaryCsv, upsertMonthlyOverrides, parseMonthlyAdSummaryCsv, upsertMonthlyAdOverrides } from "@/lib/api/amazon-monthly-overrides";
import { supabase } from "@/lib/supabase";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";
import Papa from "papaparse";

type ImportType = "business" | "advertising" | "rakuten_access" | "rakuten_sales" | "monthly_summary" | "monthly_ad_summary" | "meta_ads";

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

  const { data: rakutenProducts = [] } = useQuery({
    queryKey: ["rakutenProductsAll"],
    queryFn: () => getRakutenProducts(true),
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
      let text = await file.text();

      // 楽天アクセスCSV: 先頭の "#" メタデータ行を読み飛ばし、
      // 「商品管理番号」を含む実ヘッダー行から始める
      if (importType === "rakuten_access") {
        const lines = text.split("\n");
        const headerIdx = lines.findIndex((l) => {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith("#")) return false;
          return l.includes("商品管理番号");
        });
        if (headerIdx > 0) text = lines.slice(headerIdx).join("\n");
      }

      const { data: rows } = Papa.parse(text, { header: true, skipEmptyLines: true });
      let imported = 0;
      let skipped = 0;

      if (importType === "business") {
        for (const row of rows as any[]) {
          // ASIN列: 全角括弧「（子）ASIN」・半角括弧「(子)ASIN」・「ASIN」の全パターンに対応
          const asin =
            row["（子）ASIN"] ||   // 現行BR CSV（全角括弧）
            row["(子)ASIN"]  ||   // 旧形式（半角括弧）
            row["ASIN"]      ||
            row["asin"]      || "";
          const product = (products as any[]).find((p: any) => p.asin === asin);
          if (!product) { skipped++; continue; }

          // セッション列: 「セッション数 - 合計」（現行）と「セッション - 合計」（旧形式）両対応
          const sessions = parseInt(
            row["セッション数 - 合計"] ||
            row["セッション - 合計"]   ||
            row["sessions"] || "0"
          ) || 0;

          // 注文数・販売個数
          const orders = parseInt(
            row["注文された商品点数"] || row["units_ordered"] || "0"
          ) || 0;

          // 売上額: 「注文商品の売上額」（現行）と「注文商品売上」（旧形式）両対応
          const rawSales =
            row["注文商品の売上額"] ||   // 現行BR CSV
            row["注文商品売上"]    ||   // 旧形式
            row["ordered_product_sales"] || "0";
          const sales_amount = Math.round(
            parseFloat(String(rawSales).replace(/[,¥￥]/g, "")) || 0
          );

          // CVR
          const cvr = parseFloat(
            row["注文商品点数のセッションのパーセンテージ"] ||
            row["セッションのパーセンテージ - 注文商品点数"] || "0"
          ) || 0;

          await upsertDailySales({
            product_id: product.id,
            date: reportDate,
            sessions,
            orders,
            sales_amount,
            units_sold: orders,
            cvr,
            cancellations: 0,
            source: "csv",
          });
          imported++;
        }

        // 1件もインポートできなかった場合は原因を明示
        if (imported === 0) {
          const sampleKeys = rows.length > 0 ? Object.keys((rows as any[])[0]).join(", ") : "（行なし）";
          throw new Error(
            `0件インポート: ASINが一致する商品が見つかりませんでした。\nCSVの列名: ${sampleKeys}\n\nセラーセントラルから「詳細ページ 売上・トラフィック（子ASIN別）」CSVをダウンロードし直してください。`
          );
        }
      } else if (importType === "advertising") {
        for (const row of rows as any[]) {
          const asin = row["広告された ASIN"] || row["Advertised ASIN"] || "";
          const product = (products as any[]).find((p: any) => p.asin === asin);
          if (!product) continue;

          await upsertDailyAdvertising({
            product_id: product.id,
            date: row["日付"] || row["Date"] || reportDate,
            ad_spend: Math.round(parseFloat(row["費用"] || row["Spend"] || "0") || 0),
            ad_sales: Math.round(parseFloat(row["7日間の総売上高"] || row["7 Day Total Sales"] || "0") || 0),
            ad_orders: parseInt(row["7日間の総注文数"] || row["7 Day Total Orders"] || row["注文数"] || "0") || 0,
            impressions: parseInt(row["インプレッション"] || row["Impressions"] || "0") || 0,
            clicks: parseInt(row["クリック"] || row["Clicks"] || "0") || 0,
            acos: parseFloat(row["ACOS"] || "0") || 0,
            roas: parseFloat(row["ROAS"] || "0") || 0,
            campaign_name: row["キャンペーン名"] || row["Campaign Name"] || null,
            campaign_type: "sp",
            source: "csv",
          });
          imported++;
        }
      } else if (importType === "monthly_summary") {
        const overrides = parseMonthlySummaryCsv(text);
        const result = await upsertMonthlyOverrides(overrides);
        imported = result.saved;
        if (result.errors.length > 0) {
          throw new Error(result.errors.join(", "));
        }
      } else if (importType === "monthly_ad_summary") {
        const overrides = parseMonthlyAdSummaryCsv(text);
        const result = await upsertMonthlyAdOverrides(overrides);
        imported = result.saved;
        if (result.errors.length > 0) {
          throw new Error(result.errors.join(", "));
        }
      } else if (importType === "rakuten_sales") {
        // 楽天売上CSV（日別）
        const csvData: Array<{ productNumber: string; salesAmount: number; orders: number; unitsSold: number; date: string }> = [];
        for (const row of rows as any[]) {
          const productNumber = row["商品管理番号"] || row["商品番号"] || row["product_id"] || "";
          if (!productNumber) { skipped++; continue; }

          const salesAmount = Math.round(parseFloat(
            (row["売上"] || row["売上金額"] || row["売上額"] || row["sales"] || "0").toString().replace(/[,￥¥]/g, "")
          ) || 0);
          const orders = parseInt(
            (row["売上件数"] || row["注文数"] || row["注文件数"] || row["orders"] || "0").toString().replace(/,/g, "")
          ) || 0;
          const unitsSold = parseInt(
            (row["売上個数"] || row["販売個数"] || row["units"] || "0").toString().replace(/,/g, "")
          ) || 0;
          const date = row["日付"] || row["date"] || row["期間"] || reportDate;
          // 日付フォーマット正規化: "2026/01/01" → "2026-01-01"
          const normalizedDate = date.replace(/\//g, "-");

          if (salesAmount === 0 && orders === 0 && unitsSold === 0) { skipped++; continue; }

          csvData.push({ productNumber, salesAmount, orders, unitsSold, date: normalizedDate });
        }

        if (csvData.length > 0) {
          const result = await importRakutenSalesCSV(csvData);
          imported = result.upserted;
          if (result.errors.length > 0) {
            skipped += result.errors.length;
            console.warn("楽天売上CSVインポートエラー:", result.errors);
          }
        }
      } else if (importType === "rakuten_access") {
        // 楽天アクセス・売上CSV
        for (const row of rows as any[]) {
          // 商品番号 or 商品管理番号 で楽天商品を検索
          const productNumber = row["商品管理番号"] || row["商品番号"] || row["商品URL"] || "";
          if (!productNumber) { skipped++; continue; }

          // product_id (商品管理番号) で検索
          const rktProduct = (rakutenProducts as any[]).find((p: any) =>
            p.product_id === productNumber || p.sku === productNumber
          );
          if (!rktProduct) { skipped++; continue; }

          const accessCount = parseInt(row["アクセス人数"] || row["アクセス数"] || row["PV数"] || "0") || 0;
          const cvrRaw = row["転換率"] || row["CVR"] || row["転換率(%)"] || "0";
          const cvr = parseFloat(cvrRaw.replace("%", "")) || 0;

          // CSVに日付列がある場合はそれを使用、なければ指定日付
          const date = row["日付"] || row["対象日"] || row["集計日"] || reportDate;

          await updateRakutenAccessData({
            productId: rktProduct.id,
            date,
            accessCount,
            cvr,
          });
          imported++;
        }
      } else if (importType === "meta_ads") {
        // Meta広告CSV
        for (const row of rows as any[]) {
          const date = (row["Day"] || row["日付"] || row["date"] || "").replace(/\//g, "-");
          if (!date) { skipped++; continue; }
          const spend = parseFloat((row["Amount spent (JPY)"] || row["Amount spent"] || row["費用"] || row["spend"] || "0").toString().replace(/,/g, "")) || 0;
          if (spend === 0 && !row["Campaign name"] && !row["キャンペーン名"]) { skipped++; continue; }

          const record = {
            date,
            campaign_name: row["Campaign name"] || row["キャンペーン名"] || null,
            ad_set_name: row["Ad set name"] || row["広告セット名"] || null,
            ad_name: row["Ad name"] || row["広告名"] || null,
            impressions: parseInt((row["Impressions"] || row["インプレッション"] || "0").toString().replace(/,/g, "")) || 0,
            clicks: parseInt((row["Link clicks"] || row["Clicks (all)"] || row["クリック"] || "0").toString().replace(/,/g, "")) || 0,
            spend: Math.round(spend),
            purchases: parseInt((row["Purchases"] || row["購入"] || "0").toString().replace(/,/g, "")) || 0,
            purchase_value: Math.round(parseFloat((row["Purchase ROAS"] || "0").toString().replace(/,/g, "")) * spend) || 0,
            cpm: parseFloat((row["CPM (cost per 1,000 impressions)"] || row["CPM"] || "0").toString().replace(/,/g, "")) || 0,
            cpc: parseFloat((row["CPC (cost per link click)"] || row["CPC"] || "0").toString().replace(/,/g, "")) || 0,
            ctr: parseFloat((row["CTR (link click-through rate)"] || row["CTR"] || "0").toString().replace(/%/g, "")) || 0,
            roas: parseFloat((row["Purchase ROAS"] || row["ROAS"] || "0").toString().replace(/,/g, "")) || 0,
          };

          const { error } = await supabase.from("meta_ad_daily").upsert(record, { onConflict: "date,campaign_name,ad_set_name,ad_name" });
          if (error) { skipped++; console.warn("Meta ad upsert error:", error.message); }
          else imported++;
        }
      }

      queryClient.invalidateQueries();
      const msg = skipped > 0
        ? `${imported}件インポート完了（${skipped}件スキップ: 商品が見つからず）`
        : `${imported}件のデータをインポートしました`;
      setStatus({ type: "success", message: msg });
      setFile(null);
    } catch (err: any) {
      setStatus({ type: "error", message: `エラー: ${err.message}` });
    } finally {
      setImporting(false);
    }
  };

  const typeLabels: Record<ImportType, string> = {
    business: "ビジネスレポート",
    advertising: "広告レポート",
    rakuten_access: "楽天アクセス・売上",
    rakuten_sales: "楽天売上CSV",
    monthly_summary: "月別サマリー",
    monthly_ad_summary: "月別広告サマリー",
    meta_ads: "Meta広告",
  };

  return (
    <div>
      <PageHeader title="CSVインポート" description="Amazon・楽天のレポートCSVファイルをインポートします" />

      <div className="flex gap-2 mb-6">
        <Button variant={importType === "business" ? "default" : "outline"} onClick={() => setImportType("business")}>
          🟠 ビジネスレポート
        </Button>
        <Button variant={importType === "advertising" ? "default" : "outline"} onClick={() => setImportType("advertising")}>
          🟠 広告レポート
        </Button>
        <Button variant={importType === "rakuten_access" ? "default" : "outline"} onClick={() => setImportType("rakuten_access")}>
          🔴 楽天アクセス・売上
        </Button>
        <Button variant={importType === "rakuten_sales" ? "default" : "outline"} onClick={() => setImportType("rakuten_sales")}>
          🔴 楽天売上CSV
        </Button>
        <Button variant={importType === "monthly_summary" ? "default" : "outline"} onClick={() => setImportType("monthly_summary")}>
          🟠 月別サマリー
        </Button>
        <Button variant={importType === "monthly_ad_summary" ? "default" : "outline"} onClick={() => setImportType("monthly_ad_summary")}>
          🟠 月別広告サマリー
        </Button>
        <Button variant={importType === "meta_ads" ? "default" : "outline"} onClick={() => setImportType("meta_ads")}>
          🔵 Meta広告
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{typeLabels[importType]}のインポート</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <label className="text-sm text-[hsl(var(--muted-foreground))]">レポート日付{importType === "rakuten_access" ? "（CSV内に日付列がない場合に使用）" : ""}</label>
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
              {importType === "business" && (
                <p>セラーセントラル → レポート → ビジネスレポート → 詳細ページ 売上・トラフィック（子ASIN別）</p>
              )}
              {importType === "advertising" && (
                <p>セラーセントラル → 広告 → 広告レポート → スポンサープロダクト</p>
              )}
              {importType === "monthly_summary" && (
                <div className="space-y-1">
                  <p>セラーセントラル → レポート → ビジネスレポート → 月別サマリー</p>
                  <p className="text-xs">「表示」を「月別」にして対象期間を選択し、CSVダウンロード</p>
                  <p className="text-xs text-yellow-400">
                    ※ 取り込んだ月別合計が、月別分析ページの売上合計に優先表示されます
                  </p>
                </div>
              )}
              {importType === "monthly_ad_summary" && (
                <div className="space-y-1">
                  <p>セラーセントラル → 広告 → 広告レポート → スポンサープロダクト（日別）</p>
                  <p className="text-xs">日別の広告レポートCSVをアップロードすると、月別に自動集計して保存します</p>
                  <p className="text-xs">必要な列: 日付、費用、売上（7日間の総売上高）、注文数、インプレッション、クリック</p>
                  <p className="text-xs text-yellow-400">
                    ※ 取り込んだ月別広告費合計が、月別分析ページの広告費に優先表示されます
                  </p>
                </div>
              )}
              {importType === "meta_ads" && (
                <div className="space-y-1">
                  <p>Meta Ads Manager → レポート → エクスポート（CSV）</p>
                  <p className="text-xs">必要な列: Day, Campaign name, Impressions, Link clicks, Amount spent (JPY), Purchases, Purchase ROAS</p>
                  <p className="text-xs text-yellow-400">※ 通貨はJPY前提です</p>
                </div>
              )}
              {importType === "rakuten_sales" && (
                <div className="space-y-1">
                  <p>楽天RMS → データダウンロード → 売上データ → 日別</p>
                  <p className="text-xs">必要な列: <strong>商品管理番号</strong>（または商品番号）、<strong>売上</strong>（売上金額）、<strong>売上件数</strong>、<strong>売上個数</strong>、<strong>日付</strong></p>
                  <p className="text-xs">日付列がない場合は、上部の「レポート日付」が全行に適用されます</p>
                  <p className="text-xs text-yellow-400">
                    ※ 既存のアクセスデータ（アクセス数・CVR）は上書きされません。売上・注文数・販売個数のみ更新されます
                  </p>
                </div>
              )}
              {importType === "rakuten_access" && (
                <div className="space-y-1">
                  <p>楽天RMS → データ分析 → アクセス分析 → 商品別アクセス数</p>
                  <p className="text-xs mt-2">必要な列: <strong>商品番号</strong>（または商品管理番号）、<strong>アクセス人数</strong>（またはアクセス数）、<strong>転換率</strong>（任意）</p>
                  <p className="text-xs">商品番号は楽天の商品マスタ（設定 → 商品マスタ管理 → 楽天タブ）の「商品番号」と一致させてください</p>
                  <p className="text-xs text-yellow-400">※ 既存の売上データ（注文数・売上金額）は上書きされません。アクセス数とCVRのみ更新されます</p>
                </div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
