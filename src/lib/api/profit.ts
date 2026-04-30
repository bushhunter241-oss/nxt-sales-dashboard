/**
 * 共通利益計算関数
 *
 * 3ページ（日別・月別・商品別）で同じ計算式を使うために切り出した純粋関数。
 * ここを修正すれば全ページの利益計算が一括で更新される。
 *
 * 計算式:
 *   純利益 = 売上 - 原価 - FBA手数料(紹介料+配送) - ポイント原資 - 広告費 - 経費
 *   ※ 全体経費(product_id=null)は3ビュー共に除外する方針
 */

export interface ProductForProfit {
  cost_price?: number | null;
  fba_fee_rate?: number | null;   // Amazon紹介料率(%) 例:15 → 売上の15%
  fba_shipping_fee?: number | null; // FBA配送手数料(円/個) 例:532
  point_rate?: number | null;     // 常設ポイント付与率(%)
}

export interface RowCosts {
  cost: number;        // 原価合計
  fba_fee: number;     // FBA手数料合計(紹介料+配送手数料)
  point_cost: number;  // ポイント原資(常設+イベント)
}

/**
 * 1行の daily_sales に対する費用を計算する。
 * 日別・月別ページの reduce ループ内で呼び出す。
 *
 * @param salesAmount  その行の売上金額
 * @param unitsSold    その行の販売個数
 * @param product      products テーブルの行（null の場合は全コスト 0）
 * @param eventPointRate  施策カレンダーのイベントポイント率(%) — 省略可
 */
export function calcRowCosts(
  salesAmount: number,
  unitsSold: number,
  product: ProductForProfit | null | undefined,
  eventPointRate?: number
): RowCosts {
  if (!product) return { cost: 0, fba_fee: 0, point_cost: 0 };

  const costPrice     = product.cost_price       ?? 0;
  const fbaFeeRate    = product.fba_fee_rate      ?? 15; // 未設定時は15%（Amazon最低保証）
  const shippingFee   = product.fba_shipping_fee  ?? 0;
  const pointRate     = product.point_rate        ?? 0;

  const cost       = costPrice * unitsSold;
  const referral   = Math.round(salesAmount * (fbaFeeRate / 100));
  const shipping   = shippingFee * unitsSold;
  const fba_fee    = referral + shipping;
  const basePoint  = Math.round(salesAmount * (pointRate / 100));
  const eventPoint = eventPointRate ? Math.round(salesAmount * (eventPointRate / 100)) : 0;
  const point_cost = basePoint + eventPoint;

  return { cost, fba_fee, point_cost };
}

export interface NetProfitResult {
  gross_profit: number; // 売上 - 原価 - FBA手数料 - ポイント原資
  net_profit: number;   // 粗利 - 広告費 - 経費
  profit_rate: number;  // 純利益率(%)
}

/**
 * 集計済みの数値から純利益を計算する。
 * reduce ループ後の map や getProductSalesSummary の最終計算で呼び出す。
 */
export function calcNetProfit(
  salesAmount: number,
  cost: number,
  fbaFee: number,
  pointCost: number,
  adSpend: number,
  expenses: number
): NetProfitResult {
  const gross_profit = salesAmount - cost - fbaFee - pointCost;
  const net_profit   = gross_profit - adSpend - expenses;
  const profit_rate  = salesAmount > 0 ? (net_profit / salesAmount) * 100 : 0;
  return { gross_profit, net_profit, profit_rate };
}
