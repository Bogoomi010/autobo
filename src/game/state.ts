import {
  connectApiKeyProfile,
  fetchAccounts,
  fetchOrder,
  listApiKeyProfiles,
  placeOrder,
  saveApiKeyProfile,
  type ApiKeyProfileSummary,
  type OrderResult,
} from "../api/upbit";
import { loadGame, saveGame } from "../core/save";
import {
  ORDER_POLL_MAX,
  ORDER_POLL_MS,
  SIM_START_BALANCE,
  TRADE_LOG_MAX,
} from "./config";
import { bus, EV } from "./events";
import type { Account, ClosedTrade, CoinInfo, Payout, Position, SaveData, Ticker, WalletHolding } from "./types";

let seq = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 주문 체결 합계 (수량·평균가·체결대금) */
function sumFills(order: OrderResult): { volume: number; funds: number; avgPrice: number } {
  let volume = 0;
  let funds = 0;
  for (const t of order.trades ?? []) {
    volume += Number(t.volume);
    funds += Number(t.funds);
  }
  return { volume, funds, avgPrice: volume > 0 ? funds / volume : 0 };
}

/**
 * 게임 상태 싱글턴 — 돈의 이동은 전부 이 클래스의 메서드로만 일어난다.
 *
 * ⚠ 실거래 모드(Tauri): 잔고의 원본은 업비트 계좌다. "금고 잔액"은
 *   `계좌 KRW − 들고 있는 돈 − 바닥 돈뭉치` 로 계산한 표시값이며,
 *   출금/입금/줍기는 연출일 뿐 실제 돈 이동은 매수/매도 주문에서만 일어난다.
 *   이 게임은 자신이 매수한 포지션 물량만 자동 매도한다 (외부 보유 코인 불간섭).
 * 브라우저 모의 모드: 가상 잔고로 동일한 흐름을 시뮬레이션한다.
 */
class GameStore {
  /**
   * "real" = 실거래(실계좌) / "sim" = 모의(가상 잔고, 시세만 실제).
   * 시작 시 모드 선택 창에서 결정 → setMode()로 확정한 뒤 init()을 호출한다.
   * (실거래 주문은 Tauri Rust 커맨드 전용 — 브라우저에선 시세만 실제)
   */
  mode: "real" | "sim" = "sim";
  /** 실계좌(upbitkey) 연동 완료 여부 */
  connected = false;
  /** 매수 주문 진행 중 (중복 주문 방지) */
  orderBusy = false;

  carried = 0;
  positions: Position[] = [];
  walletHoldings: WalletHolding[] = [];
  payouts: Payout[] = [];
  trades: ClosedTrade[] = [];

  /** 실거래: 계좌의 주문 가능 KRW / 모의: 가상 잔고 */
  private accountKrw = 0;
  private simBalance = SIM_START_BALANCE;
  private coinNameBySymbol = new Map<string, string>();

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** 금고에 표시할 잔액 */
  vaultBalance(): number {
    const base = this.mode === "real" ? this.accountKrw : this.simBalance;
    const outside = this.carried + this.payouts.reduce((s, p) => s + p.amount, 0);
    return Math.max(0, Math.floor(base - (this.mode === "real" ? outside : 0)));
  }

  /**
   * 총 자산 = 현금(금고 + 들고 있는 돈 + 바닥 돈뭉치) + 투자한 코인의 **현재 시세 가치**.
   * @param tickers 최신 시세맵 — 있으면 포지션을 수량×현재가로 평가(미실현 손익 반영),
   *                없으면 매수 원금(investedKrw)으로 대체한다.
   */
  totalAssets(tickers?: Map<string, Ticker>): number {
    const positionsValue = this.positions.reduce((s, p) => {
      const t = tickers?.get(p.market);
      const current = t && p.entryPrice > 0 ? p.volume * t.price : p.investedKrw;
      return s + current;
    }, 0);
    const walletHoldingsValue = this.walletHoldings.reduce((s, h) => {
      const t = tickers?.get(h.market);
      const current = t ? h.volume * t.price : h.investedKrw;
      return s + current;
    }, 0);
    return (
      this.vaultBalance() +
      this.carried +
      positionsValue +
      walletHoldingsValue +
      this.payouts.reduce((s, p) => s + p.amount, 0)
    );
  }

  /** 시작 시 모드 선택 창에서 확정 — init() 전에 반드시 1회 호출 */
  setMode(mode: "real" | "sim"): void {
    this.mode = mode;
  }

  /** 시세 시스템이 로드한 KRW 마켓 이름 캐시를 받아 지갑 보유 코인 표시명을 보강한다. */
  setCoinCatalog(coins: CoinInfo[]): void {
    this.coinNameBySymbol = new Map(coins.map((coin) => [coin.symbol, coin.nameKo]));
    if (this.walletHoldings.length === 0) return;
    this.walletHoldings = this.walletHoldings.map((holding) => ({
      ...holding,
      nameKo: this.coinNameBySymbol.get(holding.symbol) ?? holding.nameKo,
    }));
    bus.emit(EV.WALLET_HOLDINGS, this.walletHoldings);
  }

  /** 앱 시작 시 1회 — 세이브 로드 후 실계좌 연동(실거래 모드) */
  async init(): Promise<void> {
    const data = loadGame();
    if (data) {
      this.carried = data.carried ?? 0;
      this.positions = (data.positions ?? []).map((p) => ({ ...p, status: "open" as const }));
      this.payouts = data.payouts ?? [];
      this.trades = data.trades ?? [];
      if (this.mode === "sim") this.simBalance = data.simBalance ?? SIM_START_BALANCE;
    }

    if (this.mode === "sim") {
      this.connected = true;
      bus.emit(EV.CONNECT, "connected", "sim");
    } else {
      await this.connect();
    }
    this.broadcastAll();
  }

  /**
   * 암호화 저장된 API Key 프로필 기반 실계좌 연동.
   * 저장된 프로필이 없으면 키 입력 모달을 열고, 있으면 프로필 선택 모달을 먼저 띄운다.
   * 성공 시 저장된 포지션을 실제 코인 잔고와 대조해 어긋난 수량을 보정한다.
   */
  async connect(): Promise<boolean> {
    if (this.mode !== "real") return true;
    let profiles: ApiKeyProfileSummary[];
    try {
      profiles = await listApiKeyProfiles();
    } catch (e) {
      this.connected = false;
      bus.emit(EV.CONNECT, "error", String(e));
      return false;
    }
    if (profiles.length === 0) {
      bus.emit(EV.CONNECT, "none");
      bus.emit(EV.OPEN_KEY_MODAL);
      return false;
    }
    bus.emit(EV.CONNECT, "none");
    bus.emit(EV.OPEN_PROFILE_MODAL, profiles);
    return false;
  }

  /** 저장된 프로필 선택 모달에서 호출 — 선택한 프로필로 계좌를 연동한다. */
  async connectWithProfile(profileId: string): Promise<void> {
    if (this.mode !== "real") return;
    bus.emit(EV.CONNECT, "connecting");
    try {
      this.finishConnect(await connectApiKeyProfile(profileId));
    } catch (e) {
      this.connected = false;
      bus.emit(EV.CONNECT, "error", String(e));
      throw e;
    }
  }

  /**
   * 키 입력 모달에서 호출 — 키 검증(잔고 조회) 후 암호화 저장 + 연동.
   * 실패 시 예외를 다시 던져 모달이 오류 메시지를 표시하게 한다.
   */
  async connectWithKeys(nickname: string, accessKey: string, secretKey: string): Promise<void> {
    if (this.mode !== "real") return;
    bus.emit(EV.CONNECT, "connecting");
    try {
      this.finishConnect(await saveApiKeyProfile(nickname, accessKey, secretKey));
    } catch (e) {
      this.connected = false;
      bus.emit(EV.CONNECT, "error", String(e));
      throw e;
    }
  }

  /** 연동 성공 공통 처리 — 잔고 반영·포지션 보정·상태 방송 */
  private finishConnect(accounts: Account[]): void {
    this.applyAccounts(accounts);
    this.reconcilePositions(accounts);
    this.syncWalletHoldings(accounts);
    this.connected = true;
    bus.emit(EV.CONNECT, "connected");
    this.broadcastAll();
  }

  /** 주문 후 등 — 계좌 잔고 재조회 */
  async refreshAccounts(): Promise<void> {
    if (this.mode !== "real" || !this.connected) return;
    try {
      const accounts = await fetchAccounts();
      this.applyAccounts(accounts);
      this.reconcilePositions(accounts);
      this.syncWalletHoldings(accounts);
      bus.emit(EV.WALLET, this.vaultBalance());
    } catch {
      // 일시 실패는 다음 갱신에서 복구 — 잔고 표시가 잠깐 낡을 뿐 자금엔 영향 없음
    }
  }

  private applyAccounts(accounts: Account[]): void {
    const krw = accounts.find((a) => a.currency === "KRW");
    this.accountKrw = krw ? krw.balance : 0;
  }

  private syncWalletHoldings(accounts: Account[]): void {
    if (this.mode !== "real") {
      this.walletHoldings = [];
      bus.emit(EV.WALLET_HOLDINGS, this.walletHoldings);
      return;
    }

    const managedVolumeBySymbol = new Map<string, number>();
    for (const position of this.positions) {
      managedVolumeBySymbol.set(
        position.symbol,
        (managedVolumeBySymbol.get(position.symbol) ?? 0) + position.volume
      );
    }

    this.walletHoldings = accounts
      .filter((account) => account.currency !== "KRW")
      .map((account) => {
        const totalVolume = account.balance + account.locked;
        const managedVolume = managedVolumeBySymbol.get(account.currency) ?? 0;
        const externalVolume = Math.max(0, totalVolume - managedVolume);
        return { account, externalVolume };
      })
      .filter(({ externalVolume }) => externalVolume > 0)
      .map(({ account, externalVolume }) => {
        const lockedRatio =
          account.balance + account.locked > 0 ? externalVolume / (account.balance + account.locked) : 0;
        const locked = Math.min(account.locked, account.locked * lockedRatio);
        const balance = Math.max(0, externalVolume - locked);
        return {
          market: `KRW-${account.currency}`,
          nameKo: this.coinNameBySymbol.get(account.currency) ?? account.currency,
          symbol: account.currency,
          balance,
          locked,
          volume: externalVolume,
          avgBuyPrice: account.avgBuyPrice,
          investedKrw: account.avgBuyPrice > 0 ? Math.round(externalVolume * account.avgBuyPrice) : 0,
        };
      });
    bus.emit(EV.WALLET_HOLDINGS, this.walletHoldings);
  }

  /** 저장된 포지션 수량이 실제 코인 잔고보다 크면(외부 매도 등) 보정/제거 */
  private reconcilePositions(accounts: Account[]): void {
    const balances = new Map(accounts.map((a) => [a.currency, a.balance]));
    const before = this.positions.length;
    this.positions = this.positions.filter((p) => {
      const held = balances.get(p.symbol) ?? 0;
      if (held <= 0) return false;
      if (held < p.volume) {
        p.investedKrw = Math.round((p.investedKrw * held) / p.volume);
        p.volume = held;
      }
      return true;
    });
    if (this.positions.length !== before) {
      bus.emit(EV.TOAST, "외부에서 변동된 포지션을 정리했어요", "info");
      bus.emit(EV.POSITIONS, this.positions);
      this.persist();
    }
  }

  /** 현재 상태를 모든 이벤트로 재방송 (씬/UI 초기화 후 호출용) */
  broadcastAll(): void {
    bus.emit(EV.WALLET, this.vaultBalance());
    bus.emit(EV.CARRY, this.carried);
    bus.emit(EV.POSITIONS, this.positions);
    bus.emit(EV.WALLET_HOLDINGS, this.walletHoldings);
    bus.emit(EV.PAYOUTS, this.payouts);
  }

  /** 금고에서 출금(연출) → 들고 있는 돈에 합산. 잔액 부족 시 false */
  withdraw(amount: number): boolean {
    if (amount <= 0 || amount > this.vaultBalance()) return false;
    if (this.mode === "sim") this.simBalance -= amount;
    this.carried += amount;
    bus.emit(EV.WALLET, this.vaultBalance());
    bus.emit(EV.CARRY, this.carried);
    this.persist();
    return true;
  }

  /**
   * 매수봇 실현수익을 금고에 즉시 합산(모의 모드 전용) — 정산기 돈뭉치를 배출해 바닥에서
   * 주워 입금하는 연출 없이 곧바로 반영한다. 로봇은 화면 어딘가(왼쪽 방)에 있어 정산기까지
   * 돈뭉치가 날아가는 연출을 만들기 어렵고, 봇 수익은 "바로바로" 들어와야 자연스럽다.
   */
  creditVaultFromBot(amountKrw: number): void {
    if (this.mode !== "sim" || amountKrw <= 0) return;
    this.simBalance += amountKrw;
    bus.emit(EV.WALLET, this.vaultBalance());
    this.persist();
  }

  /** 들고 있는 돈 전액을 금고에 입금(연출). 빈손이면 false */
  deposit(): boolean {
    if (this.carried <= 0) return false;
    if (this.mode === "sim") this.simBalance += this.carried;
    this.carried = 0;
    bus.emit(EV.WALLET, this.vaultBalance());
    bus.emit(EV.CARRY, this.carried);
    this.persist();
    return true;
  }

  /**
   * 들고 있는 돈 전액으로 매수. 실거래 모드에선 **실제 시장가 매수 주문**을 전송한다.
   * @param priceHint 모달에 표시된 현재가 (모의 모드 체결가로 사용)
   * @returns 성공 여부 — UI는 이걸로 모달을 닫을지 결정
   */
  async invest(coin: CoinInfo, priceHint: number): Promise<boolean> {
    if (this.carried <= 0 || this.orderBusy) return false;

    // ---- 모의 모드: 즉시 체결 ----
    if (this.mode === "sim") {
      if (priceHint <= 0) return false;
      this.pushPosition(coin, this.carried, priceHint, this.carried / priceHint);
      this.carried = 0;
      this.afterMoneyMove();
      return true;
    }

    // ---- 실거래: 시장가 매수 (ord_type=price, price=KRW 금액) ----
    if (!this.connected) {
      bus.emit(EV.TOAST, "업비트 계좌가 연동되지 않았어요", "bad");
      return false;
    }
    const budget = Math.floor(this.carried);
    this.setBusy(true);
    try {
      const placed = await placeOrder(
        { market: coin.market, side: "bid", ord_type: "price", price: String(budget) },
        false // 사용자 확정: 완전 실거래
      );
      const done = await this.waitOrderDone(placed.uuid);
      const { volume, funds, avgPrice } = sumFills(done);
      if (volume <= 0) throw new Error("체결된 수량이 없습니다");
      const fee = Number(done.paid_fee ?? 0);
      this.pushPosition(coin, Math.round(funds + fee), avgPrice, volume);
      this.carried = 0;
      await this.refreshAccounts();
      this.afterMoneyMove();
      return true;
    } catch (e) {
      bus.emit(EV.TOAST, `매수 실패: ${String(e)}`, "bad");
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * 포지션 청산 — InvestmentSystem이 ±3% 도달 시 호출.
   * 실거래 모드에선 **실제 시장가 매도 주문**을 전송하고, 체결액만큼 돈뭉치를 배출한다.
   * @param exitPriceHint 트리거 시점 시세 (모의 모드 체결가)
   */
  async closePosition(
    id: string,
    reason: ClosedTrade["reason"],
    exitPriceHint: number
  ): Promise<void> {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos || pos.status !== "open") return; // 이미 매도 진행 중 → 중복 방지
    pos.status = "selling";
    bus.emit(EV.POSITIONS, this.positions);

    // ---- 모의 모드 ----
    if (this.mode === "sim") {
      const payout = Math.max(0, Math.round((pos.investedKrw * exitPriceHint) / pos.entryPrice));
      this.finalizeClose(pos, payout, reason);
      return;
    }

    // ---- 실거래: 시장가 매도 (ord_type=market, volume=보유 수량) ----
    try {
      const placed = await placeOrder(
        { market: pos.market, side: "ask", ord_type: "market", volume: pos.volume.toFixed(8) },
        false
      );
      const done = await this.waitOrderDone(placed.uuid);
      const { funds } = sumFills(done);
      const fee = Number(done.paid_fee ?? 0);
      const proceeds = Math.max(0, Math.round(funds - fee));
      if (proceeds <= 0) throw new Error("체결 내역이 없습니다");
      this.finalizeClose(pos, proceeds, reason);
      void this.refreshAccounts();
    } catch (e) {
      // 실패 → 포지션 복구, 다음 폴링에서 재시도
      pos.status = "open";
      bus.emit(EV.POSITIONS, this.positions);
      bus.emit(EV.TOAST, `매도 실패: ${String(e)}`, "bad");
    }
  }

  /** 바닥의 돈뭉치를 주워 들고 있는 돈에 합산 */
  pickUpPayout(id: string): boolean {
    const idx = this.payouts.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.carried += this.payouts[idx].amount;
    this.payouts.splice(idx, 1);
    bus.emit(EV.CARRY, this.carried);
    bus.emit(EV.PAYOUTS, this.payouts);
    this.persist();
    return true;
  }

  // ---------- 내부 헬퍼 ----------

  private pushPosition(coin: CoinInfo, invested: number, entry: number, volume: number): void {
    this.positions.push({
      id: uid("pos"),
      market: coin.market,
      nameKo: coin.nameKo,
      symbol: coin.symbol,
      investedKrw: invested,
      entryPrice: entry,
      volume,
      status: "open",
      openedAt: Date.now(),
    });
  }

  /** 청산 확정 — 기록·돈뭉치 배출·이벤트 방송 */
  private finalizeClose(pos: Position, payoutAmount: number, reason: ClosedTrade["reason"]): void {
    // 정산액은 돈뭉치로 배출 — 줍기→입금까지는 금고 잔액에 합산되지 않는다 (연출 일관성)
    this.positions = this.positions.filter((p) => p.id !== pos.id);

    const trade: ClosedTrade = {
      market: pos.market,
      nameKo: pos.nameKo,
      symbol: pos.symbol,
      investedKrw: pos.investedKrw,
      payout: payoutAmount,
      pnlRate: pos.investedKrw > 0 ? payoutAmount / pos.investedKrw - 1 : 0,
      reason,
      closedAt: Date.now(),
    };
    this.trades.unshift(trade);
    if (this.trades.length > TRADE_LOG_MAX) this.trades.length = TRADE_LOG_MAX;

    const payout: Payout = { id: uid("pay"), amount: payoutAmount, reason };
    this.payouts.push(payout);

    bus.emit(EV.POSITIONS, this.positions);
    bus.emit(EV.PAYOUTS, this.payouts);
    bus.emit(EV.TRADE_CLOSED, trade, payout);
    this.persist();
  }

  /** 주문 최종 상태 폴링 — done/cancel(시장가 매수는 잔액 반환으로 cancel 종료가 정상)까지 대기 */
  private async waitOrderDone(uuid: string): Promise<OrderResult> {
    for (let i = 0; i < ORDER_POLL_MAX; i++) {
      await sleep(ORDER_POLL_MS);
      const order = await fetchOrder(uuid);
      if (order.state === "done" || order.state === "cancel") return order;
    }
    throw new Error(`주문 체결 확인 시간 초과 — 업비트에서 주문(${uuid.slice(0, 8)}…)을 확인하세요`);
  }

  private setBusy(busy: boolean): void {
    this.orderBusy = busy;
    bus.emit(EV.ORDER_BUSY, busy);
  }

  private afterMoneyMove(): void {
    bus.emit(EV.WALLET, this.vaultBalance());
    bus.emit(EV.CARRY, this.carried);
    bus.emit(EV.POSITIONS, this.positions);
    this.persist();
  }

  /** 저장 디바운스 (연속 변경 시 300ms 후 1회) */
  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const data: SaveData = {
        carried: this.carried,
        positions: this.positions,
        payouts: this.payouts,
        trades: this.trades,
        ...(this.mode === "sim" ? { simBalance: this.simBalance } : {}),
      };
      saveGame(data);
    }, 300);
  }
}

export const store = new GameStore();
