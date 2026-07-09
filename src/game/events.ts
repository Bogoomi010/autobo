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
  /** (market?: string) 월드 → UI: 업비트 스타일 트레이딩 보드(차트) 열기 — 거실 시세판 오브젝트 */
  OPEN_TRADING_BOARD: "open-trading-board",
  /** (없음) UI → 월드: 트레이딩 보드 닫힘 */
  TRADING_BOARD_CLOSED: "trading-board-closed",
  /** (없음) 실계좌 API Key 입력 모달 열기 (저장된 키 없음/키 변경) */
  OPEN_KEY_MODAL: "open-key-modal",
  /** (없음) 월드 → UI: 금고 출금 모달 열기 — 원하는 금액을 자유롭게 입력해 출금 */
  OPEN_WITHDRAW_MODAL: "open-withdraw-modal",
  /** (없음) UI → 월드: 출금 모달 닫힘 */
  WITHDRAW_MODAL_CLOSED: "withdraw-modal-closed",
  /** (invested: boolean) UI → 월드: 모달 닫힘 (투자 성사 여부) */
  COIN_MODAL_CLOSED: "coin-modal-closed",
  /** (msg: string, kind?: "info"|"good"|"bad") 토스트 메시지 */
  TOAST: "toast",
  /**
   * (bots: TradeBot[], meta: { enabled: boolean; scanActive: boolean; lastScanAt: number|null })
   * 로봇 매수봇 명단/상태 변경 — botDock UI 갱신용
   */
  BOTS_CHANGED: "bots-changed",
  /** (없음) 봇 생성 창 열기 — 예산/동작 시간대/익절·손절 %를 입력받아 botEngine.addBot 호출 */
  OPEN_BOT_CREATE_MODAL: "open-bot-create-modal",
  /** (botId: string) 월드 → UI: 매수봇 로봇 클릭 → 상세(현재 코인/실시간 수익률/투자 로그) 패널 열기 */
  OPEN_BOT_DETAIL: "open-bot-detail",
  /** (없음) UI → 월드: 매수봇 상세 패널 닫힘 */
  BOT_DETAIL_CLOSED: "bot-detail-closed",
  /**
   * (botId: string, amountKrw: number) 매수봇이 수익 매도해 금고에 바로 입금됐을 때(모의 모드).
   * botFloor.ts가 그 봇의 책상 위에 "+₩N" 획득 이펙트를 띄우는 트리거로 쓴다.
   */
  BOT_PROFIT_CREDITED: "bot-profit-credited",
} as const;

// 타입 참조 유지용 (페이로드 계약 문서화)
export type { ClosedTrade, Payout, Position, Ticker };
