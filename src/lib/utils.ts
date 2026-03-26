import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(value);
}

export function formatDate(date: string): string {
  const d = new Date(date);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
}

export function getDateRange(period: string): { startDate: string; endDate: string } {
  // JST基準で日付を計算（UTCとのズレ防止）
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const formatDate = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const endDate = formatDate(now);
  let start: Date;

  switch (period) {
    case '7days':
      start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case '30days':
      start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 30);
      break;
    case 'last_month':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { startDate: formatDate(start), endDate: formatDate(lastMonthEnd) };
    case 'this_month':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    default:
      start = new Date('2023-01-01');
  }

  return { startDate: formatDate(start), endDate };
}
