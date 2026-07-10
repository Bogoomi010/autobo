import { BOT_MAX_BUDGET_KRW, BOT_MIN_BUDGET_KRW } from "./types.ts";

/** 매도 후 순실현손익을 다음 매수 원금에 합산하되 앱 안전 범위를 지킨다. */
export function nextBotBudgetKrw(currentBudgetKrw: number, realizedPnlKrw: number): number {
  return Math.max(BOT_MIN_BUDGET_KRW, Math.min(BOT_MAX_BUDGET_KRW, Math.round(currentBudgetKrw + realizedPnlKrw)));
}
