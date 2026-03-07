export const PERIODS = [
  { value: 'all', label: '全期間' },
  { value: '7days', label: '7日間' },
  { value: '30days', label: '30日間' },
  { value: 'last_month', label: '先月' },
  { value: 'this_month', label: '今月' },
] as const;

export const EXPENSE_TYPES = [
  { value: 'fee', label: '手数料' },
  { value: 'shipping', label: '送料' },
  { value: 'other', label: 'その他' },
] as const;

export const INVENTORY_CHANGE_TYPES = [
  { value: 'inbound', label: '入庫' },
  { value: 'outbound', label: '出庫' },
  { value: 'adjustment', label: '調整' },
] as const;

export const CHART_COLORS = [
  '#f97316', // orange
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#eab308', // yellow
  '#06b6d4', // cyan
  '#f43f5e', // rose
] as const;
