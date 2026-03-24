export type CampaignTarget = {
  min: number | null;
  max: number | null;
  alertAt: number | null;
  note?: string;
};

export type GroupTarget = {
  groupThreshold: number;
  campaigns: Record<string, CampaignTarget>;
};

export const ACOS_TARGETS: Record<string, GroupTarget> = {
  feela: {
    groupThreshold: 35,
    campaigns: {
      TARGET:        { min: 25, max: 30, alertAt: 35 },
      MANUEL主力:     { min: 25, max: 30, alertAt: 35 },
      MANUEL広範囲:   { min: 25, max: 30, alertAt: 35 },
      'SB MOVIE':    { min: 25, max: 30, alertAt: 35 },
      AUTO:          { min: null, max: null, alertAt: null, note: '現状維持（判定なし）' },
    },
  },
  'imin お香シリーズ': {
    groupThreshold: 50,
    campaigns: {
      TARGET:              { min: 40, max: 45, alertAt: 50 },
      'MOVIE（SB）':        { min: 35, max: 40, alertAt: 45 },
      'MANUEL HS お香':     { min: 45, max: 50, alertAt: 55 },
      'MANUEL HS':         { min: 50, max: 55, alertAt: 60, note: '認知枠（55%上限）' },
      AUTO:                { min: 45, max: 50, alertAt: 55 },
    },
  },
  'imin Moonシリーズ': {
    groupThreshold: 45,
    campaigns: {
      TARGET:        { min: 30, max: 35, alertAt: 40 },
      'SB MOVIE':    { min: 35, max: 40, alertAt: 45 },
      MANUEL主力:     { min: 30, max: 35, alertAt: 40 },
      広範囲:         { min: 35, max: 35, alertAt: 40, note: '新規キャンペーン' },
    },
  },
  // Phase切替あり:
  //   現在〜5月中旬: Phase1（攻め）→ MANUEL主力 ACOS 50-60%許容
  //   6月〜: Phase3（利益確保）→ 全キャンペーン 25-30%
  // Phase3移行時は groupThreshold を 35 に変更し、MANUEL主力の alertAt も 35 に変更すること
  'imin お得用シリーズ': {
    groupThreshold: 65,
    campaigns: {
      MANUEL主力:    { min: 50, max: 60, alertAt: 65, note: 'Phase1 攻め（〜5月中旬）' },
      TARGET:       { min: 25, max: 30, alertAt: 35 },
      _phase3:      { min: 25, max: 30, alertAt: 35, note: '6月〜利益確保モード（Phase3移行後に適用）' },
    },
  },
  RHINON: {
    groupThreshold: 35,
    campaigns: {
      _default:     { min: 25, max: 30, alertAt: 35 },
    },
  },
  _default: {
    groupThreshold: 35,
    campaigns: {
      _default:     { min: 25, max: 30, alertAt: 35 },
    },
  },
} as const;

/** キャンペーン名からタイプを判定 */
export function classifyCampaign(campaignName: string): string {
  const name = campaignName || "";
  if (name.includes("TARGET")) return "TARGET";
  if (name.includes("MANUEL")) {
    if (name.includes("広範囲")) return "MANUEL広範囲";
    if (name.includes("HS お香") || name.includes("HSお香")) return "MANUEL HS お香";
    if (name.includes("HS")) return "MANUEL HS";
    return "MANUEL主力";
  }
  if (name.includes("MOVIE") || name.includes("SB")) return "SB MOVIE";
  if (name.includes("AUTO")) return "AUTO";
  return "その他";
}

/** グループ名からACOSターゲットを取得 */
export function getGroupTarget(groupName: string): GroupTarget {
  return (ACOS_TARGETS as Record<string, GroupTarget>)[groupName] || (ACOS_TARGETS as Record<string, GroupTarget>)["_default"];
}
