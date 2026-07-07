/** 게임 전역 상수 */
export const GAME_W = 1280;
export const GAME_H = 720;

/** 출금 단위 (₩) — 업비트 최소 주문금액(5,000원)보다 크게 유지할 것 */
export const MONEY_UNIT = 10_000;

/** 자동 익절 수익률 (+3%) */
export const TAKE_PROFIT_RATE = 0.03;

/** 자동 손절 수익률 (-3%) */
export const STOP_LOSS_RATE = -0.03;

/** 시세 폴링 간격 (ms) — Quotation rate limit(초당 10회)보다 훨씬 여유 있게 */
export const TICKER_POLL_MS = 3_000;

/** 주문 체결 확인 폴링 간격/최대 횟수 (시장가는 보통 즉시 체결) */
export const ORDER_POLL_MS = 700;
export const ORDER_POLL_MAX = 20;

/** HUD에 남기는 최근 거래 기록 수 */
export const TRADE_LOG_MAX = 20;

/** 브라우저 모의 모드 시작 자금 (Tauri 실거래 모드에선 미사용) */
export const SIM_START_BALANCE = 1_000_000;
