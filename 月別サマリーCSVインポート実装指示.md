# Amazon月別サマリーCSVインポート 実装指示

## 目的
Amazonセラーセントラルの「月別ビジネスレポート（ストア全体サマリー）」CSVを取り込み、
ダッシュボードの月別売上合計をCSVの正確な値で上書き補正できるようにする。

## CSVの形式（実物確認済み）

```
日付,注文商品の売上額,注文された商品点数,注文品目総数,セッション数 - 合計,注文商品セッション率,...
2026/01/01,"￥4,907,860",...,"16,779",...,5.57%,...
2026/02/01,"￥3,930,470",...,"15,922",...,4.32%,...
2026/03/01,"￥3,696,316",...,"12,493",...,5.26%,...
```

**特徴:**
- 1行 = 1ヶ月分のストア全体集計（ASIN別ではない）
- 日付は各月の1日（YYYY/MM/DD形式）
- 金額は `"￥1,234,567"` 形式（全角円マーク＋カンマ区切り）
- セッション率は `"5.57%"` 形式

---

## 現在の乖離状況

| 月 | CSV正解値 | DB現在値 | 差額 |
|---|---|---|---|
| 2026-01 | ¥4,907,860 | ¥3,046,380 | **-¥1,861,480**（SP-API欠損） |
| 2026-02 | ¥3,930,470 | ¥4,059,930 | +¥129,460 |
| 2026-03 | ¥3,696,316 | ¥3,687,586 | ¥8,730 ✅ほぼ一致 |

---

## 実装内容

### Step 1: DBマイグレーション追加

`supabase/migrations/014_amazon_monthly_overrides.sql` を新規作成：

```sql
-- Amazon月別売上オーバーライドテーブル
-- CSVから取り込んだ「正確な月別合計」をここに保存し、
-- ダッシュボードのmonthly集計でこちらを優先表示する
CREATE TABLE IF NOT EXISTS amazon_monthly_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL UNIQUE, -- 例: '2026-01'
  total_sales INTEGER NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  cvr NUMERIC(5,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'csv',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS設定
ALTER TABLE amazon_monthly_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON amazon_monthly_overrides FOR ALL USING (true);
```

---

### Step 2: CSVパース関数を作成

`src/lib/api/amazon-monthly-overrides.ts` を新規作成：

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";

export interface MonthlyOverride {
  year_month: string;   // 'YYYY-MM'
  total_sales: number;
  total_orders: number;
  total_units: number;
  sessions: number;
  cvr: number;
}

/** 全角円・カンマを除去して数値に変換 */
function parseMoney(str: string): number {
  return Math.round(parseFloat(str.replace(/[￥¥,\s"]/g, "")) || 0);
}

/** "5.57%" → 5.57 */
function parsePercent(str: string): number {
  return parseFloat(str.replace("%", "")) || 0;
}

/** "16,779" → 16779 */
function parseCount(str: string): number {
  return parseInt(str.replace(/[,"\s]/g, "")) || 0;
}

/** CSVテキストを MonthlyOverride[] に変換 */
export function parseMonthlySummaryCsv(csvText: string): MonthlyOverride[] {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // BOMを除去
  const header = lines[0].replace(/^\uFEFF/, "");
  const cols = header.split(",");

  const idx = {
    date: cols.findIndex(c => c.includes("日付")),
    sales: cols.findIndex(c => c.includes("注文商品の売上額") && !c.includes("B2B")),
    orders: cols.findIndex(c => c.includes("注文された商品点数") && !c.includes("B2B")),
    units: cols.findIndex(c => c.includes("注文品目総数") && !c.includes("B2B")),
    sessions: cols.findIndex(c => c.includes("セッション数 - 合計") && !c.includes("B2B")),
    cvr: cols.findIndex(c => c.includes("注文商品セッション率") && !c.includes("B2B")),
  };

  const results: MonthlyOverride[] = [];

  for (let i = 1; i < lines.length; i++) {
    // カンマ区切りだが金額にカンマが含まれるため、ダブルクォート対応のパースが必要
    const row = parseCSVLine(lines[i]);
    if (!row[idx.date]) continue;

    // 日付: "2026/01/01" → "2026-01"
    const dateParts = row[idx.date].replace(/"/g, "").split("/");
    if (dateParts.length < 2) continue;
    const year_month = `${dateParts[0]}-${dateParts[1].padStart(2, "0")}`;

    results.push({
      year_month,
      total_sales: parseMoney(row[idx.sales] || "0"),
      total_orders: parseCount(row[idx.orders] || "0"),
      total_units: parseCount(row[idx.units] || "0"),
      sessions: parseCount(row[idx.sessions] || "0"),
      cvr: parsePercent(row[idx.cvr] || "0"),
    });
  }

  return results;
}

/** ダブルクォートを考慮したCSV行パーサー */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

/** MonthlyOverride[] をSupabaseにupsertする */
export async function upsertMonthlyOverrides(overrides: MonthlyOverride[]): Promise<{ saved: number; errors: string[] }> {
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  let saved = 0;

  for (const o of overrides) {
    const { error } = await db
      .from("amazon_monthly_overrides")
      .upsert(
        { ...o, source: "csv", imported_at: new Date().toISOString() },
        { onConflict: "year_month" }
      );
    if (error) {
      errors.push(`${o.year_month}: ${error.message}`);
    } else {
      saved++;
    }
  }

  return { saved, errors };
}

/** 月別オーバーライドを全件取得 */
export async function getMonthlyOverrides(): Promise<Record<string, MonthlyOverride>> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("amazon_monthly_overrides")
    .select("*")
    .order("year_month", { ascending: false });

  const map: Record<string, MonthlyOverride> = {};
  for (const row of data || []) {
    map[row.year_month] = row;
  }
  return map;
}
```

---

### Step 3: インポートページにタブを追加

`src/app/(dashboard)/import/page.tsx` を修正：

**① ImportTypeに追加:**
```typescript
type ImportType = "business" | "advertising" | "rakuten_access" | "monthly_summary";
```

**② ボタンを追加:**
```tsx
<Button variant={importType === "monthly_summary" ? "default" : "outline"} onClick={() => setImportType("monthly_summary")}>
  🟠 月別サマリー
</Button>
```

**③ handleImport内に処理追加:**
```typescript
} else if (importType === "monthly_summary") {
  const overrides = parseMonthlySummaryCsv(text);
  const result = await upsertMonthlyOverrides(overrides);
  imported = result.saved;
  if (result.errors.length > 0) {
    throw new Error(result.errors.join(", "));
  }
}
```

**④ 説明テキストを追加:**
```tsx
{importType === "monthly_summary" && (
  <div className="space-y-1">
    <p>セラーセントラル → レポート → ビジネスレポート → 月別サマリー</p>
    <p className="text-xs">「表示」を「月別」にして対象期間を選択し、CSVダウンロード</p>
    <p className="text-xs text-yellow-400">
      ※ 取り込んだ月別合計が、月別分析ページの売上合計に優先表示されます
    </p>
  </div>
)}
```

---

### Step 4: 月別分析ページでオーバーライドを反映

`src/app/(dashboard)/monthly/page.tsx` を修正：

**① getMonthlyOverridesを取得してマージする:**
```typescript
// 既存のgetMonthlySalesと並行取得
const [monthlySales, overrides] = await Promise.all([
  getMonthlySales(startDate, endDate),
  getMonthlyOverrides(),
]);

// 月別データにオーバーライドを適用
const mergedData = monthlySales.map(row => {
  const ym = row.month; // 例: "2026-01"
  const override = overrides[ym];
  if (!override) return row;

  return {
    ...row,
    sales_amount: override.total_sales,       // CSV値で上書き
    orders: override.total_orders || row.orders,
    units_sold: override.total_units || row.units_sold,
    sessions: override.sessions || row.sessions,
    cvr: override.cvr || row.cvr,
    _overridden: true, // UI表示用フラグ
  };
});
```

**② オーバーライドされた行には「CSV補正済み」バッジを表示:**
```tsx
{row._overridden && (
  <span className="ml-2 text-xs text-yellow-400 border border-yellow-400/30 rounded px-1">CSV補正</span>
)}
```

---

## 実装後の確認手順

1. `npm run build` でビルドエラーがないことを確認
2. Supabaseマイグレーションを適用
3. `/import` ページを開き「🟠 月別サマリー」タブを選択
4. `BusinessReport-22-03-26.csv`（または`BusinessReport-20-03-26.csv`）をドロップしてインポート
5. `/monthly` ページで以下の数値になることを確認：
   - 2026-01: ¥4,907,860（CSV補正済みバッジあり）
   - 2026-02: ¥3,930,470（CSV補正済みバッジあり）
   - 2026-03: ¥3,696,316（ほぼSP-API一致）

---

## 補足：セッション数の大幅な乖離について

| 月 | CSV(店舗全体) | DB(商品合計) |
|---|---|---|
| 1月 | 16,779 | 2,949 |
| 2月 | 15,922 | 5,220 |
| 3月 | 12,493 | 4,245 |

CSVのセッション数は「ストア全体のユニークセッション」、DBは「各商品ページのセッション合計」のため、
同じ訪問者が複数商品を見た場合の重複カウント差異によるものです。
これはデータの定義が異なるため、完全一致にはなりません。今回は**売上金額の補正を優先**します。
