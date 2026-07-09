/**
 * 매수봇 표시용 공용 포맷 헬퍼 — botDock(HUD 카드), 월드 호버 툴팁, 상세 패널이 함께 쓴다.
 */
import { krw, pct } from "../game/format";
import { BOT_TYPE_LABEL, type BotState, type BotType, type TradeBot } from "./types";

export const BOT_STATE_LABEL: Record<BotState, string> = {
  idle: "대기 중",
  scanning: "탐색 중",
  targeting: "조준!",
  buying: "매수 중",
  holding: "보유 중",
  selling: "매도 중",
  sold_profit: "익절 완료",
  sold_loss: "손절 완료",
  error: "오류",
};

/** 진행 중(점멸 표시 대상) 상태 — botDock CSS 애니메이션과 동일 기준 */
export function isBotBusyState(state: BotState): boolean {
  return state === "buying" || state === "selling" || state === "targeting";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function fmtKstTime(at: number): string {
  const d = new Date(at + 9 * 60 * 60 * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function botTypeIcon(botType: BotType): string {
  return botType === "scalp" ? "⚡" : "🌱";
}

export function botTypeLabel(botType: BotType): string {
  return BOT_TYPE_LABEL[botType];
}

/** "₩10,000 · 19:30(30분) · +3.0%/-2.0%" */
export function formatBotSettingsLine(bot: TradeBot): string {
  const sw = bot.settings.scanWindow;
  const time =
    typeof sw.startAt === "number" && typeof sw.endAt === "number"
      ? `${fmtKstTime(sw.startAt)}~${fmtKstTime(sw.endAt)}(${fmtDuration(sw.durationMinutes)})`
      : `${pad2(sw.startHourKst)}:${pad2(sw.startMinute)}(${fmtDuration(sw.durationMinutes)})`;
  return `${krw(bot.settings.budgetKrw)} · ${time} · +${(bot.settings.takeProfitRate * 100).toFixed(1)}%/-${(bot.settings.stopLossRate * 100).toFixed(1)}%`;
}

/** "누적 ₩0 · 0건" */
export function formatBotFootLine(bot: TradeBot): string {
  return `누적 ${krw(bot.realizedPnlKrw)} · ${bot.tradesDone}건`;
}

/** 현재 수익률 텍스트 — 값 없으면 빈 문자열 */
export function formatBotPnl(bot: TradeBot): string {
  return bot.currentPnlRate !== null ? pct(bot.currentPnlRate) : "";
}

/** 현재 pnl 부호에 따른 색상("up"=빨강 상승/"down"=파랑 하락, 업비트 관례) */
export function botPnlSignClass(bot: TradeBot): "up" | "down" | "" {
  if (bot.currentPnlRate === null) return "";
  if (bot.currentPnlRate > 0) return "up";
  if (bot.currentPnlRate < 0) return "down";
  return "";
}

/**
 * 매수봇 "꾸미기" 등급 — 누적 실현손익(realizedPnlKrw)을 1회 예산(budgetKrw)의 몇 배 벌었는지로 매긴다.
 * 예산이 다른 봇끼리도 공정하게 비교하려고 절대 KRW 대신 배율을 쓴다.
 * 등급은 고정이 아니라 매 순간 현재 누적손익으로 다시 계산돼, 손실이 나면 장식도 같이 벗겨진다
 * (책상/로봇 장식은 botFloor.ts가 이 등급에 맞춰 붙이고 뗀다).
 */
export interface BotTier {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function botTier(bot: TradeBot): BotTier {
  const budget = bot.settings.budgetKrw > 0 ? bot.settings.budgetKrw : 1;
  const ratio = bot.realizedPnlKrw / budget; // 누적 실현손익 ÷ 1회 예산 — "예산의 몇 배를 벌었는가"
  if (ratio >= 8) return { level: 4, label: "🏆 전설" };
  if (ratio >= 3) return { level: 3, label: "🥇 베테랑" };
  if (ratio >= 1) return { level: 2, label: "🥈 우수" };
  if (ratio > 0) return { level: 1, label: "🥉 성장 중" };
  return { level: 0, label: "신입" };
}
