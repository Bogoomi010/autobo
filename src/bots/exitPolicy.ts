import { BOT_HOLD_LIMIT_MS } from "./types.ts";

export type LongtermExitDecision = "loss" | "profit" | "timeout" | "wait" | "evaluate_signal";

export interface LongtermExitPolicyInput {
  pnlRate: number;
  takeProfitRate: number;
  stopLossRate: number;
  heldMs: number;
  maxHoldMs: number;
}

/**
 * 장투봇 고정 청산 정책.
 * 손절과 익절은 목표에 도달하면 즉시 적용하고, 붕괴 신호 평가는 24시간 이후에만 연다.
 */
export function decideLongtermExit(input: LongtermExitPolicyInput): LongtermExitDecision {
  if (input.pnlRate <= -input.stopLossRate) return "loss";
  if (input.pnlRate >= input.takeProfitRate) return "profit";
  if (input.heldMs < BOT_HOLD_LIMIT_MS) return "wait";
  if (input.heldMs >= input.maxHoldMs) return "timeout";
  return "evaluate_signal";
}
