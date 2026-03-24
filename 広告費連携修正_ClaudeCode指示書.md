# 広告費API連携修正 — Claude Code 実行指示書

## 問題

ダッシュボード「広告管理」ページの広告費が、セラーセントラル（及びGoogle Sheets手動記録）の実績と一致しない。

現在のダッシュボード（30日間）: 広告費合計 ¥409,507 / 広告売上 ¥1,058,926

## 現状のアーキテクチャ

Amazon Ads API → `ads-api-sync.ts` → `daily_advertising` テーブル → 広告管理ページ

- cron (`/api/cron/sync`) が毎日 JST 2:00 に前日分のみ同期
- 手動同期 (`/api/sync/ads-api`) はデフォルト直近7日分
- レポート種別: `spAdvertisedProduct` (ASIN別日別)
- 取得カラム: date, advertisedAsin, campaignName, impressions, clicks, cost, purchases7d, sales7d

## 調査すべきこと（Claude Code で実行）

### 調査1: Ads API同期ログの確認

Supabaseで以下のSQLを実行して、直近のAds API同期が正常に動いているか確認：

```sql
SELECT id, api_type, status, trigger, records_processed, error_message,
       start_date, end_date, created_at
FROM api_sync_logs
WHERE api_type = 'ads-api'
ORDER BY created_at DESC
LIMIT 20;
```

確認ポイント：
- status が 'completed' か 'failed' か
- records_processed が 0 なら同期が空振りしている
- error_message に認証エラーやレポート失敗がないか
- 直近30日分が連続して同期されているか、抜けている日がないか

### 調査2: daily_advertising テーブルのデータ検証

```sql
-- 直近30日の日別広告費合計
SELECT date, SUM(ad_spend) as total_spend, SUM(ad_sales) as total_sales,
       COUNT(*) as records, source
FROM daily_advertising
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY date, source
ORDER BY date DESC;
```

```sql
-- データが入っていない日を発見
SELECT d::date as missing_date
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, '1 day') d
WHERE d::date NOT IN (SELECT DISTINCT date FROM daily_advertising);
```

確認ポイント：
- 全日にデータがあるか（抜けがないか）
- source が 'ads-api' か 'csv' か
- 1日あたりの records 数が妥当か（商品数 × キャンペーンタイプ分）

### 調査3: Ads API認証情報の有効性確認

```sql
SELECT api_type, has_credentials,
       CASE WHEN token_expires_at IS NOT NULL
            THEN token_expires_at > NOW()
            ELSE false END as token_valid,
       token_expires_at, profile_id
FROM api_credentials
WHERE api_type = 'ads-api';
```

確認ポイント：
- has_credentials = true か
- profile_id が設定されているか
- token_expires_at が期限切れでないか（refresh_token があれば自動更新されるはず）

---

## 修正計画（調査結果に応じて実行）

### パターンA: 同期は動いているがデータが歯抜け

**原因:** cronが前日分1日しか同期しないため、失敗した日のデータが永久に欠損

**修正:**
1. `/api/sync/ads-api` の手動同期で過去30日分を一括リクエスト可能にする（現在もstartDate/endDate指定で可能）
2. cron側も過去3日分を同期するように変更（`src/app/api/cron/sync/route.ts` line 34 付近）
3. API連携設定ページ (`src/app/(dashboard)/settings/api-integration/page.tsx`) に「過去30日分を再同期」ボタンを追加

```typescript
// cron/sync/route.ts 修正案
// 前日だけでなく過去3日分を同期（歯抜け防止）
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const startDateStr = threeDaysAgo.toISOString().split("T")[0];
const endDateStr = yesterday.toISOString().split("T")[0];
```

### パターンB: 同期は動いているがAPIの値自体がズレている

**原因:** Amazon Ads APIの`sales7d`（7日間アトリビューション）とセラセンの表示値（14日間アトリビューション）の差

**修正:**
1. `ads-api.ts` の `requestSpProductReport()` で `sales14d`, `purchases14d` も取得するようカラムを追加
2. `ads-api-sync.ts` の `processAdsReportData()` で `sales14d` を優先使用（現在 line 87: `row.sales14d || row.sales7d`）
3. `requestSpProductReport()` の columns に `"sales14d"`, `"orders14d"` を追加：

```typescript
// ads-api.ts line 197-208 修正案
columns: [
  "date",
  "advertisedAsin",
  "campaignName",
  "impressions",
  "clicks",
  "cost",
  "purchases7d",
  "purchases14d",  // ← 追加
  "sales7d",
  "sales14d",      // ← 追加
],
```

### パターンC: 認証が切れている / profile_id が未設定

**修正:**
1. API連携設定ページで認証情報を再設定するようユーザーに案内
2. `getProfiles()` を呼んで利用可能なプロファイル一覧を取得
3. JP marketplace のプロファイルIDを `api_credentials` に保存

### パターンD: データは正確だが広告管理ページの表示ロジックに問題

**確認:**
- `getAdSummary()` が全レコードを正しく合算しているか
- 期間フィルタ (`startDate`, `endDate`) が正しく適用されているか
- オーバーライドロジック（Claude Codeで追加済み）が意図通り動作しているか

---

## 実行手順（Claude Codeへ）

1. **調査1〜3のSQLをSupabase経由で実行して結果を報告**（コードを書く前にまず現状把握）
2. **調査結果に基づいて、パターンA〜Dのどれに該当するか判断**
3. **該当パターンの修正を実装**
4. `npx tsc --noEmit` でビルド確認

**重要:** Supabaseへの直接クエリは `.env.local` の anon key では DDL/管理系操作はできない。
- SELECT クエリは Next.js の API route を通すか、Supabase JS クライアントで実行可能
- 調査用の一時的な API route (`/api/debug/ad-check`) を作って調査 → 調査後に削除

---

## 関連ファイル

| ファイル | 用途 |
|---|---|
| `src/lib/amazon/ads-api.ts` | Ads API クライアント（レポートリクエスト・DL） |
| `src/lib/sync/ads-api-sync.ts` | レポートデータ → daily_advertising upsert |
| `src/app/api/sync/ads-api/route.ts` | 手動同期API（2フェーズ） |
| `src/app/api/cron/sync/route.ts` | 日次cron（前日分のみ同期） |
| `src/lib/amazon/auth.ts` | OAuth2 トークン管理 |
| `src/lib/amazon/config.ts` | API設定（エンドポイント・リトライ等） |
| `src/app/(dashboard)/settings/api-integration/page.tsx` | API連携設定UI |
| `src/lib/api/api-sync.ts` | 同期ログCRUD |
| `src/app/(dashboard)/advertising/page.tsx` | 広告管理ページ（オーバーライド適用済み） |
