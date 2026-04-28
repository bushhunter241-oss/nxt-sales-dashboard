/**
 * 商品フィルタ共通ヘルパー
 * 親商品（is_parent=true）とアーカイブ商品を除外する
 */

/** クライアントサイド: Amazon商品の配列フィルタ */
export function filterActiveProducts(items: any[], productKey = "product"): any[] {
  // 子ASINのparent_asinを収集して親ASINを自動判定
  const childParentAsins = new Set<string>();
  for (const item of items) {
    const p = item[productKey];
    if (p?.parent_asin) childParentAsins.add(p.parent_asin);
  }

  return items.filter(item => {
    const p = item[productKey];
    if (!p) return true; // productが未JOIN
    if (p.is_archived) return false;
    if (p.is_parent) return false;
    // is_parent未設定でも、子ASINが参照している親ASINなら除外
    if (p.asin && childParentAsins.has(p.asin)) return false;
    return true;
  });
}

/** クライアントサイド: 楽天商品の配列フィルタ */
export function filterActiveRakutenProducts(items: any[], productKey = "rakuten_product"): any[] {
  return items.filter(item => {
    const p = item[productKey];
    if (!p) return true;
    if (p.is_archived) return false;
    return true;
  });
}

/** 楽天: 子商品が存在する親商品のUUIDかどうか判定 */
export function isRakutenParent(productId: string, parentUuids: Set<string>): boolean {
  return parentUuids.has(productId);
}
