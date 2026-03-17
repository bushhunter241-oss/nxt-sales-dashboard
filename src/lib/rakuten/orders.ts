/**
 * 楽天 RMS API — 受注検索・取得
 */

import { getEsaAuthHeader, RMS_API_BASE } from "./auth";

export interface RakutenCreds {
  serviceSecret: string;
  licenseKey: string;
}

interface SkuModel {
  variantId?: string;
  merchantDefinedSkuId?: string;
  skuInfo?: string;
}

export interface OrderItem {
  itemNumber?: string;
  itemName?: string;
  itemId?: string;
  manageNumber?: string;
  price?: number;
  units?: number;
  taxPrice?: number;
  priceTaxIncl?: number;
  selectedChoice?: string;
  SkuModelList?: SkuModel[];
}

export interface RakutenOrder {
  orderNumber?: string;
  orderDatetime?: string;
  totalPrice?: number;
  requestPrice?: number;
  goodsPrice?: number;
  goodsTax?: number;
  postagePrice?: number;
  deliveryPrice?: number;
  paymentCharge?: number;
  pointAmount?: number;
  couponAllTotalPrice?: number;
  status?: string;
  PackageModelList?: Array<{
    ItemModelList?: OrderItem[];
  }>;
}

interface SearchOrderResponse {
  MessageModelList?: Array<{ messageType: string; messageCode: string; message: string }>;
  orderNumberList?: string[];
  PaginationResponseModel?: { totalRecordsAmount: number; totalPages: number };
}

interface GetOrderResponse {
  MessageModelList?: Array<{ messageType: string }>;
  OrderModelList?: RakutenOrder[];
}

/**
 * 受注番号一覧を検索
 */
export async function searchOrders(
  creds: RakutenCreds,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const auth = getEsaAuthHeader(creds);
  const startDatetime = `${startDate}T00:00:00+0900`;
  const endDatetime = `${endDate}T23:59:59+0900`;

  const allOrderNumbers: string[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${RMS_API_BASE}/es/2.0/order/searchOrder/`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        dateType: 1,
        startDatetime,
        endDatetime,
        PaginationRequestModel: {
          requestRecordsAmount: pageSize,
          requestPage: page,
        },
      }),
    });

    const bodyText = await res.text();

    if (!res.ok) {
      throw new Error(`楽天 searchOrder failed (${res.status}): ${bodyText.substring(0, 300)}`);
    }

    let data: SearchOrderResponse;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error(`楽天 searchOrder: JSONパース失敗 (status=${res.status}): ${bodyText.substring(0, 200)}`);
    }

    if (data.orderNumberList && data.orderNumberList.length > 0) {
      allOrderNumbers.push(...data.orderNumberList);
    }

    const totalPages = data.PaginationResponseModel?.totalPages || 0;
    hasMore = page < totalPages;
    page++;

    if (hasMore) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return allOrderNumbers;
}

/**
 * 受注番号リストから受注詳細を取得（最大100件ずつ）
 */
export async function getOrders(
  creds: RakutenCreds,
  orderNumbers: string[]
): Promise<RakutenOrder[]> {
  const auth = getEsaAuthHeader(creds);
  const allOrders: RakutenOrder[] = [];

  for (let i = 0; i < orderNumbers.length; i += 100) {
    const batch = orderNumbers.slice(i, i + 100);

    const res = await fetch(`${RMS_API_BASE}/es/2.0/order/getOrder/`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        orderNumberList: batch,
        version: 7,
      }),
    });

    const bodyText2 = await res.text();

    if (!res.ok) {
      throw new Error(`楽天 getOrder failed (${res.status}): ${bodyText2.substring(0, 300)}`);
    }

    let data: GetOrderResponse;
    try {
      data = JSON.parse(bodyText2);
    } catch {
      throw new Error(`楽天 getOrder: JSONパース失敗 (status=${res.status}): ${bodyText2.substring(0, 200)}`);
    }

    if (data.OrderModelList) {
      allOrders.push(...data.OrderModelList);
    }

    if (i + 100 < orderNumbers.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return allOrders;
}

/**
 * 受注データ一括取得
 */
export async function fetchRakutenOrders(
  creds: RakutenCreds,
  dateFrom: string,
  dateTo: string
): Promise<RakutenOrder[]> {
  const orderNumbers = await searchOrders(creds, dateFrom, dateTo);
  if (orderNumbers.length === 0) return [];
  return getOrders(creds, orderNumbers);
}
