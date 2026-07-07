import Phaser from "phaser";
import type { ClosedTrade, Payout, Position, Ticker } from "./types";

/**
 * 전역 이벤트 버스 — Scene(월드) ↔ DOM UI ↔ 시스템 간 통신은 전부 여기를 거친다.
 * 직접 참조(Scene에서 UI 함수 호출 등) 금지.
 */
export const bus = new Phaser.Events.EventEmitter();

/** 이벤트 이름 상수와 페이로드 계약 */
export const EV = {
  /** (balance: number) 금고에 표시할 잔액 변경 (실거래: 계좌 KRW − 들고 있는 돈 − 바닥 돈뭉치) */
  WALLET: "wallet-changed",
  /** (carried: number) 들고 있는 돈 변경. 0이면 빈손 */
  CARRY: "carry-changed",
  /** (positions: Position[]) 열린 포지션 목록 변경 */
  POSITIONS: "positions-changed",
  /** (trade: ClosedTrade, payout: Payout) 자동 익절/손절 체결 완료 */
  TRADE_CLOSED: "trade-closed",
  /** (payouts: Payout[]) 바닥에 놓인 돈뭉치 목록 변경 */
  PAYOUTS: "payouts-changed",
  /** (tickers: Map<string, Ticker>) 시세 갱신 (폴링마다) */
  TICKERS: "tickers-updated",
  /** (ok: boolean) 업비트 시세 API 연결 상태 변경 */
  API_STATUS: "api-status",
  /**
   * (state: "none"|"connecting"|"connected"|"error", detail?: string)
   * 실계좌(upbitkey) 연동 상태. 모의 모드에선 "sim" 문자열 detail과 함께 "connected".
   */
  CONNECT: "connect-status",
  /** (busy: boolean, label?: string) 주문 진행 중 여부 — UI 잠금/스피너 표시용 */
  ORDER_BUSY: "order-busy",
  /** (없음) 월드 → UI: 코인 목록 모달 열기 */
  OPEN_COIN_MODAL: "open-coin-modal",
  /** (없음) 실계좌 API Key 입력 모달 열기 (저장된 키 없음/키 변경) */
  OPEN_KEY_MODAL: "open-key-modal",
  /** (invested: boolean) UI → 월드: 모달 닫힘 (투자 성사 여부) */
  COIN_MODAL_CLOSED: "coin-modal-closed",
  /** (msg: string, kind?: "info"|"good"|"bad") 토스트 메시지 */
  TOAST: "toast",
} as const;

// 타입 참조 유지용 (페이로드 계약 문서화)
export type { ClosedTrade, Payout, Position, Ticker };
