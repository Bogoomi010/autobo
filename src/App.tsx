import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ExternalLink,
  KeyRound,
  ListChecks,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Star,
  Wallet,
} from "lucide-react";
import "./App.css";

type OrderRequest = {
  market: string;
  side: "bid" | "ask";
  volume?: string | null;
  price?: string | null;
  ord_type: "limit" | "price" | "market" | "best";
  identifier?: string | null;
  time_in_force?: string | null;
};

type Ticker = {
  market: string;
  trade_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  acc_trade_volume_24h: number;
  acc_trade_price_24h: number;
};

type TradeVolumeSnapshot = {
  market: string;
  last_trade_price: number;
  last_trade_volume: number;
  accumulated_volume: number;
  accumulated_trade_value: number;
  accumulated_bid_volume?: number;
  accumulated_ask_volume?: number;
  accumulated_bid_trade_value?: number;
  accumulated_ask_trade_value?: number;
  trade_count: number;
  last_trade_timestamp?: number | null;
  ask_bid?: string | null;
};

type OrderbookSnapshot = {
  market: string;
  best_ask_price: number;
  best_bid_price: number;
  best_ask_size: number;
  best_bid_size: number;
  total_ask_size: number;
  total_bid_size: number;
  spread: number;
  spread_rate: number;
  received_at: number;
  exchange_timestamp?: number | null;
};

type AssetAccount = {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
  avg_buy_price_modified?: boolean;
  unit_currency: string;
};

type MarketInfo = {
  market: string;
  korean_name: string;
  english_name: string;
  market_warning?: string;
  market_event?: {
    warning?: boolean;
    caution?: Record<string, boolean>;
  };
};

type CandleApiResponse = {
  market: string;
  candle_date_time_utc: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
};

type ChartCandle = CandlestickData<UTCTimestamp>;

type ChartTimeframe =
  | "seconds"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "60m"
  | "240m"
  | "1d"
  | "1w"
  | "1mo"
  | "1y";

type MarketSortMode = "price" | "changeRate" | "tradeValue";
type SortDirection = "desc" | "asc";
type ManualOrderPreset = "limit" | "marketBuy" | "marketSell";

type StrategySettings = {
  mode: "price" | "tick";
  intervalSec: string;
  buyBelow: string;
  buyKrw: string;
  sellAbove: string;
  sellVolume: string;
  cooldownSec: string;
  tickWindowSec: string;
  momentumTicks: string;
  buyImbalanceThreshold: string;
  sellImbalanceThreshold: string;
  upTickRatioThreshold: string;
  minTradeValueKrw: string;
  minOrderKrw: string;
  maxPositionKrw: string;
  maxExposureKrw: string;
  minVolatilityRate: string;
  maxSpreadRate: string;
  takeProfitRate: string;
  stopLossRate: string;
  dailyStopLossRate: string;
  lossStreakLimit: string;
  maxHoldingSec: string;
  feeRate: string;
  slippageRate: string;
  safetyMarginRate: string;
  staleDataSec: string;
  maxDailyOrders: string;
};

type MarketSort = {
  mode: MarketSortMode;
  direction: SortDirection;
};

type UserPreferences = {
  market: string;
  dryRun: boolean;
  marketSearch: string;
  marketSort: MarketSort;
  chartTimeframe: ChartTimeframe;
  strategy: StrategySettings;
  manualOrder: OrderRequest;
};

type LogEntry = {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  at: string;
};

const chartTimeframes: { value: ChartTimeframe; label: string }[] = [
  { value: "seconds", label: "초" },
  { value: "1m", label: "1분" },
  { value: "3m", label: "3분" },
  { value: "5m", label: "5분" },
  { value: "10m", label: "10분" },
  { value: "15m", label: "15분" },
  { value: "30m", label: "30분" },
  { value: "60m", label: "1시간" },
  { value: "240m", label: "4시간" },
  { value: "1d", label: "일" },
  { value: "1w", label: "주" },
  { value: "1mo", label: "월" },
  { value: "1y", label: "년" },
];

const numberFormat = new Intl.NumberFormat("ko-KR");
const percentFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const ASSET_WINDOW_LABEL = "asset";
const CHART_AUTO_REFRESH_MS = 15_000;
const MARKET_TICKER_REFRESH_MS = 10_000;
const FAVORITE_MARKETS_STORAGE_KEY = "autobo.favoriteMarkets";
const USER_PREFERENCES_STORAGE_KEY = "autobo.userPreferences.v1";
const defaultStrategy: StrategySettings = {
  mode: "price",
  intervalSec: "10",
  buyBelow: "",
  buyKrw: "10000",
  sellAbove: "",
  sellVolume: "",
  cooldownSec: "60",
  tickWindowSec: "10",
  momentumTicks: "8",
  buyImbalanceThreshold: "58",
  sellImbalanceThreshold: "58",
  upTickRatioThreshold: "60",
  minTradeValueKrw: "5000000",
  minOrderKrw: "10000",
  maxPositionKrw: "10000",
  maxExposureKrw: "10000",
  minVolatilityRate: "0.05",
  maxSpreadRate: "0.08",
  takeProfitRate: "0.25",
  stopLossRate: "0.2",
  dailyStopLossRate: "1",
  lossStreakLimit: "3",
  maxHoldingSec: "180",
  feeRate: "0.05",
  slippageRate: "0.03",
  safetyMarginRate: "0.04",
  staleDataSec: "5",
  maxDailyOrders: "20",
};
const defaultManualOrder: OrderRequest = {
  market: "KRW-BTC",
  side: "bid",
  volume: "",
  price: "",
  ord_type: "limit",
  identifier: "",
  time_in_force: "",
};
const defaultMarketSort: MarketSort = {
  mode: "tradeValue",
  direction: "desc",
};

type TradeSignalSample = {
  market: string;
  at: number;
  price: number;
  tradeValue: number;
  bidTradeValue: number;
  askTradeValue: number;
  tradeCount: number;
  direction: "up" | "down" | "flat";
};

type TickStrategyStatus = {
  action: "wait" | "buy" | "sell";
  reason: string;
  buyScore: number;
  sellScore: number;
  buyImbalanceRate: number;
  sellImbalanceRate: number;
  upTickRate: number;
  consecutiveUpTicks: number;
  tradeValue: number;
  spreadRate: number;
  expectedRequiredRate: number;
  volatilityRate: number;
};

type StrategyPosition = {
  market: string;
  entryPrice: number;
  volume: number;
  quoteAmount: number;
  enteredAt: number;
};

type TickStrategyStats = {
  day: string;
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  realizedPnl: number;
  realizedPnlRate: number;
};

type OrderChanceConstraints = {
  bidFeeRate?: number;
  askFeeRate?: number;
  minTotalKrw?: number;
};
const defaultUserPreferences: UserPreferences = {
  market: "KRW-BTC",
  dryRun: true,
  marketSearch: "",
  marketSort: defaultMarketSort,
  chartTimeframe: "5m",
  strategy: defaultStrategy,
  manualOrder: defaultManualOrder,
};

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function nowText() {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function isMarketCode(value: string) {
  return /^KRW-[A-Z0-9]+$/.test(value);
}

function loadFavoriteMarkets() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(FAVORITE_MARKETS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toUpperCase())
      .filter(isMarketCode);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChartTimeframe(value: unknown): value is ChartTimeframe {
  return chartTimeframes.some((item) => item.value === value);
}

function isMarketSortMode(value: unknown): value is MarketSortMode {
  return value === "price" || value === "changeRate" || value === "tradeValue";
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "desc" || value === "asc";
}

function isOrderSide(value: unknown): value is OrderRequest["side"] {
  return value === "bid" || value === "ask";
}

function isOrderType(value: unknown): value is OrderRequest["ord_type"] {
  return value === "limit" || value === "price" || value === "market" || value === "best";
}

function isStrategyMode(value: unknown): value is StrategySettings["mode"] {
  return value === "price" || value === "tick";
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function loadUserPreferences(): UserPreferences {
  if (typeof window === "undefined") {
    return defaultUserPreferences;
  }

  try {
    const stored = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return defaultUserPreferences;
    }

    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) {
      return defaultUserPreferences;
    }

    const strategy = isRecord(parsed.strategy) ? parsed.strategy : {};
    const manualOrder = isRecord(parsed.manualOrder) ? parsed.manualOrder : {};
    const marketSort = isRecord(parsed.marketSort) ? parsed.marketSort : {};
    const market = stringValue(parsed.market, defaultUserPreferences.market).trim().toUpperCase();

    return {
      market: isMarketCode(market) ? market : defaultUserPreferences.market,
      dryRun: typeof parsed.dryRun === "boolean" ? parsed.dryRun : defaultUserPreferences.dryRun,
      marketSearch: stringValue(parsed.marketSearch),
      marketSort: {
        mode: isMarketSortMode(marketSort.mode) ? marketSort.mode : defaultUserPreferences.marketSort.mode,
        direction: isSortDirection(marketSort.direction)
          ? marketSort.direction
          : defaultUserPreferences.marketSort.direction,
      },
      chartTimeframe: isChartTimeframe(parsed.chartTimeframe)
        ? parsed.chartTimeframe
        : defaultUserPreferences.chartTimeframe,
      strategy: {
        mode: isStrategyMode(strategy.mode) ? strategy.mode : defaultStrategy.mode,
        intervalSec: stringValue(strategy.intervalSec, defaultStrategy.intervalSec),
        buyBelow: stringValue(strategy.buyBelow),
        buyKrw: stringValue(strategy.buyKrw, defaultStrategy.buyKrw),
        sellAbove: stringValue(strategy.sellAbove),
        sellVolume: stringValue(strategy.sellVolume),
        cooldownSec: stringValue(strategy.cooldownSec, defaultStrategy.cooldownSec),
        tickWindowSec: stringValue(strategy.tickWindowSec, defaultStrategy.tickWindowSec),
        momentumTicks: stringValue(strategy.momentumTicks, defaultStrategy.momentumTicks),
        buyImbalanceThreshold: stringValue(strategy.buyImbalanceThreshold, defaultStrategy.buyImbalanceThreshold),
        sellImbalanceThreshold: stringValue(strategy.sellImbalanceThreshold, defaultStrategy.sellImbalanceThreshold),
        upTickRatioThreshold: stringValue(strategy.upTickRatioThreshold, defaultStrategy.upTickRatioThreshold),
        minTradeValueKrw: stringValue(strategy.minTradeValueKrw, defaultStrategy.minTradeValueKrw),
        minOrderKrw: stringValue(strategy.minOrderKrw, defaultStrategy.minOrderKrw),
        maxPositionKrw: stringValue(strategy.maxPositionKrw, defaultStrategy.maxPositionKrw),
        maxExposureKrw: stringValue(strategy.maxExposureKrw, defaultStrategy.maxExposureKrw),
        minVolatilityRate: stringValue(strategy.minVolatilityRate, defaultStrategy.minVolatilityRate),
        maxSpreadRate: stringValue(strategy.maxSpreadRate, defaultStrategy.maxSpreadRate),
        takeProfitRate: stringValue(strategy.takeProfitRate, defaultStrategy.takeProfitRate),
        stopLossRate: stringValue(strategy.stopLossRate, defaultStrategy.stopLossRate),
        dailyStopLossRate: stringValue(strategy.dailyStopLossRate, defaultStrategy.dailyStopLossRate),
        lossStreakLimit: stringValue(strategy.lossStreakLimit, defaultStrategy.lossStreakLimit),
        maxHoldingSec: stringValue(strategy.maxHoldingSec, defaultStrategy.maxHoldingSec),
        feeRate: stringValue(strategy.feeRate, defaultStrategy.feeRate),
        slippageRate: stringValue(strategy.slippageRate, defaultStrategy.slippageRate),
        safetyMarginRate: stringValue(strategy.safetyMarginRate, defaultStrategy.safetyMarginRate),
        staleDataSec: stringValue(strategy.staleDataSec, defaultStrategy.staleDataSec),
        maxDailyOrders: stringValue(strategy.maxDailyOrders, defaultStrategy.maxDailyOrders),
      },
      manualOrder: {
        market: isMarketCode(stringValue(manualOrder.market).trim().toUpperCase())
          ? stringValue(manualOrder.market).trim().toUpperCase()
          : defaultManualOrder.market,
        side: isOrderSide(manualOrder.side) ? manualOrder.side : defaultManualOrder.side,
        volume: stringValue(manualOrder.volume),
        price: stringValue(manualOrder.price),
        ord_type: isOrderType(manualOrder.ord_type) ? manualOrder.ord_type : defaultManualOrder.ord_type,
        identifier: stringValue(manualOrder.identifier),
        time_in_force: stringValue(manualOrder.time_in_force),
      },
    };
  } catch {
    return defaultUserPreferences;
  }
}

function saveUserPreferences(preferences: UserPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function clearUserPreferences() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(USER_PREFERENCES_STORAGE_KEY);
}

function toChartCandle(candle: CandleApiResponse): ChartCandle | null {
  const timestamp = Date.parse(`${candle.candle_date_time_utc}Z`);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return {
    time: Math.floor(timestamp / 1000) as UTCTimestamp,
    open: candle.opening_price,
    high: candle.high_price,
    low: candle.low_price,
    close: candle.trade_price,
  };
}

function formatMarketPrice(market: string, price: number) {
  if (!Number.isFinite(price)) {
    return "-";
  }

  const quoteCurrency = market.split("-")[0] ?? "";
  const formattedPrice = price.toLocaleString("ko-KR", {
    maximumFractionDigits: quoteCurrency === "KRW" ? 3 : 8,
  });

  return `${formattedPrice} ${quoteCurrency}`;
}

function formatTradeVolume(market: string, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }

  const baseCurrency = market.split("-")[1] ?? "";
  const formattedValue = value.toLocaleString("ko-KR", {
    maximumFractionDigits: 8,
  });

  return `${formattedValue} ${baseCurrency}`;
}

function formatTradeValue(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }

  return `${Math.round(value).toLocaleString("ko-KR")} KRW`;
}

function parsePositiveNumber(value: string, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
}

function parseNonNegativeNumber(value: string, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : fallback;
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) ? nextValue : null;
  }

  return null;
}

function percentInputToRate(value: string, fallbackPercent: number) {
  return parseNonNegativeNumber(value, fallbackPercent) / 100;
}

function clampRate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${percentFormat.format(value * 100)}%`;
}

function calculateCandleVolatility(candles: ChartCandle[]) {
  const recentCandles = candles.slice(-6);
  if (recentCandles.length === 0) {
    return 0;
  }

  const volatilitySum = recentCandles.reduce((sum, candle) => {
    const close = Number(candle.close);
    if (!Number.isFinite(close) || close <= 0) {
      return sum;
    }

    return sum + (Number(candle.high) - Number(candle.low)) / close;
  }, 0);

  return volatilitySum / recentCandles.length;
}

function extractOrderChanceConstraints(value: unknown): OrderChanceConstraints {
  if (!isRecord(value)) {
    return {};
  }

  const market = isRecord(value.market) ? value.market : {};
  const bidPolicy = isRecord(market.bid) ? market.bid : {};
  const askPolicy = isRecord(market.ask) ? market.ask : {};
  const bidMinTotal = parseOptionalNumber(bidPolicy.min_total);
  const askMinTotal = parseOptionalNumber(askPolicy.min_total);
  const marketMinTotal = parseOptionalNumber(market.min_total);
  const minCandidates = [bidMinTotal, askMinTotal, marketMinTotal].filter(
    (item): item is number => item !== null && item > 0,
  );

  return {
    bidFeeRate: parseOptionalNumber(value.bid_fee) ?? undefined,
    askFeeRate: parseOptionalNumber(value.ask_fee) ?? undefined,
    minTotalKrw: minCandidates.length > 0 ? Math.max(...minCandidates) : undefined,
  };
}

function createDefaultTickStrategyStats(): TickStrategyStats {
  return {
    day: new Date().toDateString(),
    trades: 0,
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    realizedPnl: 0,
    realizedPnlRate: 0,
  };
}

function parseAssetAmount(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getAssetMarket(account: AssetAccount) {
  const currency = account.currency.trim().toUpperCase();
  const unitCurrency = (account.unit_currency || "KRW").trim().toUpperCase();

  if (!currency || currency === unitCurrency || unitCurrency !== "KRW") {
    return null;
  }

  return `${unitCurrency}-${currency}`;
}

function formatAssetQuantity(value: number, currency: string) {
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 8 })} ${currency}`;
}

function formatAssetQuote(value: number | null, unitCurrency: string) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toLocaleString("ko-KR", {
    maximumFractionDigits: unitCurrency === "KRW" ? 1 : 8,
    minimumFractionDigits: unitCurrency === "KRW" ? 1 : 0,
  })} ${unitCurrency}`;
}

function formatAssetMoney(value: number | null, unitCurrency: string) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${Math.round(value).toLocaleString("ko-KR")} ${unitCurrency}`;
}

function formatAssetProfit(value: number | null, unitCurrency: string) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.round(Math.abs(value)).toLocaleString("ko-KR")} ${unitCurrency}`;
}

function formatAssetProfitRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${percentFormat.format(Math.abs(value))}%`;
}

function getProfitTone(value: number | null) {
  if (value === null || value === 0) {
    return "flat";
  }

  return value > 0 ? "up" : "down";
}

function AssetWindow() {
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const [assetTickers, setAssetTickers] = useState<Record<string, Ticker>>({});
  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuoteError(null);
    try {
      const response = await invoke<AssetAccount[]>("get_session_accounts");
      const nextAccounts = Array.isArray(response) ? response : [];
      setAccounts(nextAccounts);

      const [tickerResponse, marketResponse] = await Promise.allSettled([
        nextAccounts.some((account) => account.currency.trim().toUpperCase() !== "KRW")
          ? invoke<Ticker[]>("get_quote_tickers", { quoteCurrencies: "KRW" })
          : Promise.resolve([]),
        invoke<MarketInfo[]>("get_markets", { isDetails: false }),
      ]);

      if (tickerResponse.status === "fulfilled") {
        setAssetTickers(
          tickerResponse.value.reduce<Record<string, Ticker>>((result, ticker) => {
            result[ticker.market] = ticker;
            return result;
          }, {}),
        );
      } else {
        setAssetTickers({});
        setQuoteError(String(tickerResponse.reason));
      }

      if (marketResponse.status === "fulfilled") {
        setMarketNames(
          marketResponse.value.reduce<Record<string, string>>((result, market) => {
            result[market.market] = market.korean_name;
            return result;
          }, {}),
        );
      } else {
        setMarketNames({});
      }
    } catch (nextError) {
      setAccounts([]);
      setAssetTickers({});
      setMarketNames({});
      setError(String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("asset-window-body");
    return () => document.body.classList.remove("asset-window-body");
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlisten: (() => void) | undefined;
    WebviewWindow.getCurrent()
      .listen("asset-session-updated", () => {
        refreshAccounts();
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      unlisten?.();
    };
  }, [refreshAccounts]);

  return (
    <main className="asset-shell">
      <section className="asset-header panel">
        <div>
          <span className="eyebrow">Upbit Account</span>
          <h1>자산</h1>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={refreshAccounts}>
          <RefreshCw size={17} />
          새로고침
        </button>
      </section>

      <section className="panel asset-panel">
        {error ? <div className="state-box error">{error}</div> : null}
        {!error && loading && accounts.length === 0 ? <div className="state-box">자산 정보를 불러오는 중입니다.</div> : null}
        {!error && !loading && accounts.length === 0 ? <div className="state-box">표시할 자산 정보가 없습니다.</div> : null}
        {!error && quoteError ? <div className="asset-quote-warning">현재가 일부를 불러오지 못했습니다. 보유 수량과 평균 매수가는 그대로 표시됩니다.</div> : null}
        {!error && accounts.length > 0 ? (
          <div className="asset-card-list">
            {accounts.map((account) => {
              const market = getAssetMarket(account);
              const unitCurrency = (account.unit_currency || "KRW").trim().toUpperCase();
              const balance = parseAssetAmount(account.balance);
              const locked = parseAssetAmount(account.locked);
              const avgBuyPrice = parseAssetAmount(account.avg_buy_price);
              const ticker = market ? assetTickers[market] : null;
              const currentPrice = account.currency.trim().toUpperCase() === "KRW" ? 1 : ticker?.trade_price ?? null;
              const evaluationAmount = currentPrice === null ? null : balance * currentPrice;
              const purchaseAmount = avgBuyPrice > 0 ? balance * avgBuyPrice : 0;
              const profitAmount = evaluationAmount !== null && purchaseAmount > 0 ? evaluationAmount - purchaseAmount : null;
              const profitRate = profitAmount !== null && purchaseAmount > 0 ? (profitAmount / purchaseAmount) * 100 : null;
              const profitTone = getProfitTone(profitAmount);
              const displayName = marketNames[market ?? ""] ?? (account.currency === "KRW" ? "원화" : account.currency);

              return (
                <article className="asset-card" key={`${account.currency}-${account.unit_currency}`}>
                  <header className="asset-card-header">
                    <div className="asset-identity">
                      <div>
                        <h2>{displayName}</h2>
                        <strong>({account.currency})</strong>
                      </div>
                      {market ? (
                        <span className="asset-market-icon" title={market}>
                          <ExternalLink size={32} strokeWidth={2.1} />
                        </span>
                      ) : null}
                    </div>
                    <div className="asset-profit-summary">
                      <span>평가손익</span>
                      <strong className={profitTone}>{formatAssetProfit(profitAmount, unitCurrency)}</strong>
                      <span>수익률</span>
                      <strong className={profitTone}>{formatAssetProfitRate(profitRate)}</strong>
                    </div>
                  </header>

                  <div className="asset-card-divider" />

                  <dl className="asset-metrics">
                    <div>
                      <dt>보유수량</dt>
                      <dd>{formatAssetQuantity(balance, account.currency)}</dd>
                    </div>
                    <div>
                      <dt>매수평균가</dt>
                      <dd>{formatAssetQuote(avgBuyPrice, unitCurrency)}</dd>
                    </div>
                    <div>
                      <dt>평가금액</dt>
                      <dd>{formatAssetMoney(evaluationAmount, unitCurrency)}</dd>
                    </div>
                    <div>
                      <dt>매수금액</dt>
                      <dd>{formatAssetMoney(purchaseAmount, unitCurrency)}</dd>
                    </div>
                    {locked > 0 ? (
                      <div>
                        <dt>주문 중</dt>
                        <dd>{formatAssetQuantity(locked, account.currency)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function App() {
  if (window.location.hash === "#/assets") {
    return <AssetWindow />;
  }

  const [initialPreferences] = useState(loadUserPreferences);
  const [accountLinked, setAccountLinked] = useState(false);
  const [accountStatus, setAccountStatus] = useState<"checking" | "linked" | "failed">("checking");
  const [market, setMarket] = useState(initialPreferences.market);
  const [dryRun, setDryRun] = useState(initialPreferences.dryRun);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [accounts, setAccounts] = useState<unknown>(null);
  const [chance, setChance] = useState<unknown>(null);
  const [lastOrder, setLastOrder] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastTradeAtRef = useRef(0);
  const logIdRef = useRef(1);
  const accountConnectAttemptedRef = useRef(false);
  const dryRunRef = useRef(dryRun);
  const tradeSignalSamplesRef = useRef<TradeSignalSample[]>([]);
  const lastTradeSnapshotTotalsRef = useRef<
    Record<
      string,
      {
        tradeValue: number;
        bidTradeValue: number;
        askTradeValue: number;
        tradeCount: number;
        price: number;
      }
    >
  >({});
  const strategyOrderCountRef = useRef({ day: new Date().toDateString(), count: 0 });
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const chartRefreshInFlightRef = useRef(false);
  const marketTickerRefreshInFlightRef = useRef(false);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [marketTickers, setMarketTickers] = useState<Record<string, Ticker>>({});
  const [tradeVolumes, setTradeVolumes] = useState<Record<string, TradeVolumeSnapshot>>({});
  const [orderbooks, setOrderbooks] = useState<Record<string, OrderbookSnapshot>>({});
  const [tickStrategyStatus, setTickStrategyStatus] = useState<TickStrategyStatus | null>(null);
  const [strategyPosition, setStrategyPosition] = useState<StrategyPosition | null>(null);
  const [tickStrategyStats, setTickStrategyStats] = useState<TickStrategyStats>(createDefaultTickStrategyStats);
  const [marketSearch, setMarketSearch] = useState(initialPreferences.marketSearch);
  const [favoriteMarkets, setFavoriteMarkets] = useState<string[]>(loadFavoriteMarkets);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [marketSort, setMarketSort] = useState<MarketSort>(initialPreferences.marketSort);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>(initialPreferences.chartTimeframe);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<StrategySettings>(initialPreferences.strategy);

  const [manualOrder, setManualOrder] = useState<OrderRequest>(initialPreferences.manualOrder);

  const isKeyReady = accountLinked;
  const normalizedMarket = market.trim().toUpperCase();
  const selectedMarketInfo = useMemo(
    () => markets.find((item) => item.market === normalizedMarket) ?? null,
    [markets, normalizedMarket],
  );
  const selectedTimeframeLabel = useMemo(
    () => chartTimeframes.find((item) => item.value === chartTimeframe)?.label ?? chartTimeframe,
    [chartTimeframe],
  );
  const selectedTradeVolume = tradeVolumes[normalizedMarket] ?? null;
  const selectedOrderbook = orderbooks[normalizedMarket] ?? null;
  const orderChanceConstraints = useMemo(() => extractOrderChanceConstraints(chance), [chance]);
  const krwMarketCodes = useMemo(() => markets.map((item) => item.market), [markets]);
  const hasSelectedMarketWarning =
    selectedMarketInfo?.market_warning === "CAUTION" || selectedMarketInfo?.market_event?.warning === true;
  const favoriteMarketSet = useMemo(() => new Set(favoriteMarkets), [favoriteMarkets]);
  const emptyMarketMessage = showFavoritesOnly
    ? favoriteMarkets.length === 0
      ? "즐겨찾기한 종목이 없습니다."
      : "조건에 맞는 즐겨찾기 종목이 없습니다."
    : "조건에 맞는 종목이 없습니다.";
  const toggleMarketSort = useCallback((mode: MarketSortMode) => {
    setMarketSort((current) => ({
      mode,
      direction: current.mode === mode && current.direction === "desc" ? "asc" : "desc",
    }));
  }, []);
  const toggleMarketFavorite = useCallback((event: MouseEvent<HTMLButtonElement>, marketCode: string) => {
    event.stopPropagation();
    setFavoriteMarkets((current) => {
      if (current.includes(marketCode)) {
        return current.filter((item) => item !== marketCode);
      }

      return [...current, marketCode].sort((left, right) => left.localeCompare(right));
    });
  }, []);
  const activeManualOrderPreset = useMemo<ManualOrderPreset | null>(() => {
    if (manualOrder.ord_type === "limit") {
      return "limit";
    }

    if (manualOrder.side === "bid" && manualOrder.ord_type === "price") {
      return "marketBuy";
    }

    if (manualOrder.side === "ask" && manualOrder.ord_type === "market") {
      return "marketSell";
    }

    return null;
  }, [manualOrder.ord_type, manualOrder.side]);
  const applyManualOrderPreset = useCallback(
    (preset: ManualOrderPreset) => {
      setManualOrder((current) => {
        if (preset === "marketBuy") {
          return {
            ...current,
            market: normalizedMarket,
            side: "bid",
            volume: "",
            ord_type: "price",
            time_in_force: "",
          };
        }

        if (preset === "marketSell") {
          return {
            ...current,
            market: normalizedMarket,
            side: "ask",
            price: "",
            ord_type: "market",
            time_in_force: "",
          };
        }

        return {
          ...current,
          market: normalizedMarket,
          ord_type: "limit",
        };
      });
    },
    [normalizedMarket],
  );
  const filteredMarkets = useMemo(() => {
    const search = marketSearch.trim().toLowerCase();

    const filtered = markets.filter((item) => {
      const matchesKrwMarket = item.market.startsWith("KRW-");
      const matchesFavorite = !showFavoritesOnly || favoriteMarketSet.has(item.market);
      const matchesSearch =
        search === "" ||
        item.market.toLowerCase().includes(search) ||
        item.korean_name.toLowerCase().includes(search) ||
        item.english_name.toLowerCase().includes(search);

      return matchesKrwMarket && matchesFavorite && matchesSearch;
    });

    return [...filtered].sort((left, right) => {
      const leftTicker = marketTickers[left.market];
      const rightTicker = marketTickers[right.market];
      const leftVolume = tradeVolumes[left.market];
      const rightVolume = tradeVolumes[right.market];
      const leftValue =
        marketSort.mode === "price"
          ? leftTicker?.trade_price
          : marketSort.mode === "changeRate"
            ? leftTicker?.signed_change_rate
            : leftVolume?.accumulated_trade_value;
      const rightValue =
        marketSort.mode === "price"
          ? rightTicker?.trade_price
          : marketSort.mode === "changeRate"
            ? rightTicker?.signed_change_rate
            : rightVolume?.accumulated_trade_value;

      if (leftValue == null && rightValue == null) {
        return left.market.localeCompare(right.market);
      }

      if (leftValue == null) {
        return 1;
      }

      if (rightValue == null) {
        return -1;
      }

      const delta = leftValue - rightValue;
      return marketSort.direction === "desc" ? -delta : delta;
    });
  }, [favoriteMarketSet, marketSearch, marketSort, marketTickers, markets, showFavoritesOnly, tradeVolumes]);

  useEffect(() => {
    dryRunRef.current = dryRun;
  }, [dryRun]);

  useEffect(() => {
    window.localStorage.setItem(FAVORITE_MARKETS_STORAGE_KEY, JSON.stringify(favoriteMarkets));
  }, [favoriteMarkets]);

  useEffect(() => {
    saveUserPreferences({
      market: normalizedMarket,
      dryRun,
      marketSearch,
      marketSort,
      chartTimeframe,
      strategy,
      manualOrder: {
        ...manualOrder,
        market: manualOrder.market.trim().toUpperCase(),
      },
    });
  }, [chartTimeframe, dryRun, manualOrder, marketSearch, marketSort, normalizedMarket, strategy]);

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    const next: LogEntry = {
      id: logIdRef.current++,
      level,
      message,
      at: nowText(),
    };
    setLogs((current) => [next, ...current].slice(0, 80));
  }, []);

  useEffect(() => {
    if (accountConnectAttemptedRef.current) {
      return;
    }

    accountConnectAttemptedRef.current = true;

    const connectAccount = async () => {
      setAccountStatus("checking");
      try {
        const response = await invoke<AssetAccount[]>("connect_upbitkey_account");
        setAccounts(Array.isArray(response) ? response : []);
        setAccountLinked(true);
        setAccountStatus("linked");
        addLog("info", "연동되었습니다");
        window.alert("연동되었습니다");
      } catch (error) {
        setAccountLinked(false);
        setAccountStatus("failed");
        addLog("error", String(error));
        window.alert("계좌 연동에 실패했습니다");
      }
    };

    void connectAccount();
  }, [addLog]);

  const refreshMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const response = await invoke<MarketInfo[]>("get_markets", {
        isDetails: true,
      });
      const krwMarkets = response.filter((item) => item.market.startsWith("KRW-"));
      setMarkets(krwMarkets);

      const fallbackMarket =
        krwMarkets.find((item) => item.market === "KRW-BTC") ??
        krwMarkets[0];

      setMarket((current) => {
        const currentMarket = current.trim().toUpperCase();
        if (krwMarkets.some((item) => item.market === currentMarket)) {
          return currentMarket;
        }

        return fallbackMarket?.market ?? (currentMarket || "KRW-BTC");
      });
    } catch (error) {
      const message = String(error);
      setMarketsError(message);
      addLog("error", message);
    } finally {
      setMarketsLoading(false);
    }
  }, [addLog]);

  const refreshMarketTickers = useCallback(async () => {
    if (markets.length === 0 || marketTickerRefreshInFlightRef.current) {
      return;
    }

    marketTickerRefreshInFlightRef.current = true;
    try {
      const response = await invoke<Ticker[]>("get_quote_tickers", {
        quoteCurrencies: "KRW",
      });
      const nextTickers = response.reduce<Record<string, Ticker>>((result, ticker) => {
        result[ticker.market] = ticker;
        return result;
      }, {});
      setMarketTickers(nextTickers);
    } catch (error) {
      addLog("error", String(error));
    } finally {
      marketTickerRefreshInFlightRef.current = false;
    }
  }, [addLog, markets]);

  const refreshCandles = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? true;
    if (!isMarketCode(normalizedMarket)) {
      setCandles([]);
      setChartError("마켓 코드를 선택하거나 입력하세요. 예: KRW-BTC");
      if (showLoading) {
        setChartLoading(false);
      }
      return;
    }

    if (chartRefreshInFlightRef.current) {
      return;
    }

    chartRefreshInFlightRef.current = true;
    if (showLoading) {
      setChartLoading(true);
    }
    setChartError(null);
    try {
      const response = await invoke<CandleApiResponse[]>("get_candles", {
        market: normalizedMarket,
        timeframe: chartTimeframe,
        count: 100,
      });
      const nextCandles = response
        .map(toChartCandle)
        .filter((candle): candle is ChartCandle => candle !== null)
        .sort((a, b) => Number(a.time) - Number(b.time));
      setCandles(nextCandles);
    } catch (error) {
      const message = String(error);
      setCandles([]);
      setChartError(message);
      addLog("error", message);
    } finally {
      chartRefreshInFlightRef.current = false;
      if (showLoading) {
        setChartLoading(false);
      }
    }
  }, [addLog, chartTimeframe, normalizedMarket]);

  const invokeOrder = useCallback(
    async (order: OrderRequest) => {
      const currentDryRun = dryRunRef.current;
      const result = await invoke("place_order", {
        order,
        dryRun: currentDryRun,
      });
      setLastOrder(result);
      addLog(
        currentDryRun ? "warn" : "info",
        `${currentDryRun ? "모의" : "실거래"} 주문 처리: ${order.side}/${order.ord_type} ${order.market}`,
      );
      return result;
    },
    [addLog],
  );

  const refreshTicker = useCallback(async () => {
    const response = await invoke<Ticker[]>("get_ticker", {
      markets: normalizedMarket,
    });
    const nextTicker = response[0];
    setTicker(nextTicker);
    return nextTicker;
  }, [normalizedMarket]);

  const refreshPrivateData = useCallback(async () => {
    if (!isKeyReady) {
      addLog("warn", "계좌 API가 연동되지 않았습니다.");
      return;
    }

    const [nextAccounts, nextChance] = await Promise.all([
      invoke("get_session_accounts"),
      invoke("get_order_chance", {
        market: normalizedMarket,
      }),
    ]);
    setAccounts(nextAccounts);
    setChance(nextChance);
    addLog("info", "잔고와 주문 가능정보를 갱신했습니다.");
  }, [addLog, isKeyReady, normalizedMarket]);

  const resetDailyStrategyOrderCount = useCallback(() => {
    const today = new Date().toDateString();
    if (strategyOrderCountRef.current.day !== today) {
      strategyOrderCountRef.current = { day: today, count: 0 };
    }
    setTickStrategyStats((current) => (current.day === today ? current : createDefaultTickStrategyStats()));
  }, []);

  const buildTickStrategyStatus = useCallback(
    (nextTicker: Ticker): TickStrategyStatus => {
      const now = Date.now();
      const windowMs = parsePositiveNumber(strategy.tickWindowSec, 10) * 1000;
      const samples = tradeSignalSamplesRef.current.filter(
        (sample) => sample.market === normalizedMarket && sample.at >= now - windowMs,
      );
      const tradeValue = samples.reduce((sum, sample) => sum + sample.tradeValue, 0);
      const bidTradeValue = samples.reduce((sum, sample) => sum + sample.bidTradeValue, 0);
      const askTradeValue = samples.reduce((sum, sample) => sum + sample.askTradeValue, 0);
      const momentumTicks = Math.max(Math.floor(parsePositiveNumber(strategy.momentumTicks, 8)), 1);
      const directionalTicks = samples.filter((sample) => sample.direction !== "flat").slice(-momentumTicks);
      const upTicks = directionalTicks.filter((sample) => sample.direction === "up").length;
      const consecutiveUpTicks = [...directionalTicks]
        .reverse()
        .findIndex((sample) => sample.direction !== "up");
      const normalizedConsecutiveUpTicks =
        consecutiveUpTicks === -1 ? directionalTicks.length : Math.max(consecutiveUpTicks, 0);
      const buyImbalanceRate = tradeValue > 0 ? bidTradeValue / tradeValue : 0;
      const sellImbalanceRate = tradeValue > 0 ? askTradeValue / tradeValue : 0;
      const upTickRate = directionalTicks.length > 0 ? upTicks / directionalTicks.length : 0;
      const volatilityRate = calculateCandleVolatility(candles);
      const spreadRate = selectedOrderbook?.spread_rate ?? 1;
      const configuredFeeRate = percentInputToRate(strategy.feeRate, 0.05);
      const bidFeeRate = orderChanceConstraints.bidFeeRate ?? configuredFeeRate;
      const askFeeRate = orderChanceConstraints.askFeeRate ?? configuredFeeRate;
      const slippageRate = percentInputToRate(strategy.slippageRate, 0.03);
      const safetyMarginRate = percentInputToRate(strategy.safetyMarginRate, 0.04);
      const expectedRequiredRate = bidFeeRate + askFeeRate + slippageRate + spreadRate + safetyMarginRate;
      const minTradeValue = parsePositiveNumber(strategy.minTradeValueKrw, 5_000_000);
      const minOrderKrw = Math.max(
        parsePositiveNumber(strategy.minOrderKrw, 10_000),
        orderChanceConstraints.minTotalKrw ?? 0,
      );
      const buyThreshold = percentInputToRate(strategy.buyImbalanceThreshold, 58);
      const sellThreshold = percentInputToRate(strategy.sellImbalanceThreshold, 58);
      const upTickThreshold = percentInputToRate(strategy.upTickRatioThreshold, 60);
      const maxSpreadRate = percentInputToRate(strategy.maxSpreadRate, 0.08);
      const minVolatilityRate = percentInputToRate(strategy.minVolatilityRate, 0.05);
      const takeProfitRate = percentInputToRate(strategy.takeProfitRate, 0.25);
      const liquidityScore = clampRate(tradeValue / minTradeValue);
      const tradeImbalanceScore = clampRate((buyImbalanceRate - 0.5) / Math.max(buyThreshold - 0.5, 0.01));
      const upTickScore = clampRate(upTickRate / Math.max(upTickThreshold, 0.01));
      const spreadScore = selectedOrderbook ? clampRate(1 - spreadRate / Math.max(maxSpreadRate, 0.0001)) : 0;
      const volatilityScore = clampRate(volatilityRate / Math.max(minVolatilityRate, 0.0001));
      const orderbookSupportScore = selectedOrderbook
        ? clampRate(selectedOrderbook.total_bid_size / Math.max(selectedOrderbook.total_bid_size + selectedOrderbook.total_ask_size, 1))
        : 0;
      const buyScore =
        0.3 * tradeImbalanceScore +
        0.2 * upTickScore +
        0.2 * orderbookSupportScore +
        0.1 * liquidityScore +
        0.1 * volatilityScore +
        0.1 * spreadScore;
      const sellScore = clampRate((sellImbalanceRate - 0.5) / Math.max(sellThreshold - 0.5, 0.01));

      if (!selectedOrderbook) {
        return {
          action: "wait",
          reason: "호가 WebSocket 스냅샷 대기",
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      const staleDataMs = parsePositiveNumber(strategy.staleDataSec, 5) * 1000;
      if (now - selectedOrderbook.received_at > staleDataMs) {
        return {
          action: "wait",
          reason: "호가 데이터 지연",
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      if (hasSelectedMarketWarning) {
        return {
          action: "wait",
          reason: "주의 마켓은 틱 전략 진입 제외",
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      const activePosition = strategyPosition?.market === normalizedMarket ? strategyPosition : null;
      if (activePosition) {
        const exitPrice = selectedOrderbook.best_bid_price || nextTicker.trade_price;
        const grossReturnRate = activePosition.entryPrice > 0 ? (exitPrice - activePosition.entryPrice) / activePosition.entryPrice : 0;
        const heldMs = now - activePosition.enteredAt;
        const stopLossRate = percentInputToRate(strategy.stopLossRate, 0.2);
        const maxHoldingMs = parsePositiveNumber(strategy.maxHoldingSec, 180) * 1000;

        if (grossReturnRate >= takeProfitRate) {
          return {
            action: "sell",
            reason: `익절 조건 충족 ${formatRate(grossReturnRate)}`,
            buyScore,
            sellScore,
            buyImbalanceRate,
            sellImbalanceRate,
            upTickRate,
            consecutiveUpTicks: normalizedConsecutiveUpTicks,
            tradeValue,
            spreadRate,
            expectedRequiredRate,
            volatilityRate,
          };
        }

        if (grossReturnRate <= -stopLossRate) {
          return {
            action: "sell",
            reason: `손절 조건 충족 ${formatRate(grossReturnRate)}`,
            buyScore,
            sellScore,
            buyImbalanceRate,
            sellImbalanceRate,
            upTickRate,
            consecutiveUpTicks: normalizedConsecutiveUpTicks,
            tradeValue,
            spreadRate,
            expectedRequiredRate,
            volatilityRate,
          };
        }

        if (heldMs >= maxHoldingMs) {
          return {
            action: "sell",
            reason: "최대 보유 시간 초과",
            buyScore,
            sellScore,
            buyImbalanceRate,
            sellImbalanceRate,
            upTickRate,
            consecutiveUpTicks: normalizedConsecutiveUpTicks,
            tradeValue,
            spreadRate,
            expectedRequiredRate,
            volatilityRate,
          };
        }

        if (sellImbalanceRate >= sellThreshold) {
          return {
            action: "sell",
            reason: `매도 주도 체결 비율 ${formatRate(sellImbalanceRate)}`,
            buyScore,
            sellScore,
            buyImbalanceRate,
            sellImbalanceRate,
            upTickRate,
            consecutiveUpTicks: normalizedConsecutiveUpTicks,
            tradeValue,
            spreadRate,
            expectedRequiredRate,
            volatilityRate,
          };
        }

        return {
          action: "wait",
          reason: `가상 포지션 보유 중, 현재 수익률 ${formatRate(grossReturnRate)}`,
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      if (takeProfitRate <= expectedRequiredRate) {
        return {
          action: "wait",
          reason: "목표 수익률이 비용 조건보다 낮음",
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      const buyKrw = parsePositiveNumber(strategy.buyKrw, 0);
      const expectedVolume = selectedOrderbook.best_ask_price > 0 ? buyKrw / selectedOrderbook.best_ask_price : 0;
      const hasEnoughAskSize = selectedOrderbook.best_ask_size >= expectedVolume * 1.5;
      const maxPositionKrw = parsePositiveNumber(strategy.maxPositionKrw, 10_000);
      const maxExposureKrw = parsePositiveNumber(strategy.maxExposureKrw, maxPositionKrw);
      const dailyStopLossRate = percentInputToRate(strategy.dailyStopLossRate, 1);
      const lossStreakLimit = Math.floor(parsePositiveNumber(strategy.lossStreakLimit, 3));
      if (tickStrategyStats.realizedPnlRate <= -dailyStopLossRate) {
        return {
          action: "wait",
          reason: `일일 손실 제한 도달 ${formatRate(tickStrategyStats.realizedPnlRate)}`,
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      if (tickStrategyStats.consecutiveLosses >= lossStreakLimit) {
        return {
          action: "wait",
          reason: `연속 손실 제한 도달 ${tickStrategyStats.consecutiveLosses}회`,
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      if (buyKrw < minOrderKrw) {
        return {
          action: "wait",
          reason: `매수 금액이 최소 주문 금액보다 작음 ${formatTradeValue(minOrderKrw)}`,
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      if (buyKrw > maxPositionKrw || buyKrw > maxExposureKrw) {
        return {
          action: "wait",
          reason: "주문 금액이 포지션/노출 한도를 초과",
          buyScore,
          sellScore,
          buyImbalanceRate,
          sellImbalanceRate,
          upTickRate,
          consecutiveUpTicks: normalizedConsecutiveUpTicks,
          tradeValue,
          spreadRate,
          expectedRequiredRate,
          volatilityRate,
        };
      }

      const hasBuySignal =
        buyKrw > 0 &&
        tradeValue >= minTradeValue &&
        buyImbalanceRate >= buyThreshold &&
        upTickRate >= upTickThreshold &&
        spreadRate <= maxSpreadRate &&
        volatilityRate >= minVolatilityRate &&
        hasEnoughAskSize &&
        buyScore >= 0.68;

      return {
        action: hasBuySignal ? "buy" : "wait",
        reason: hasBuySignal
          ? `매수 후보 점수 ${buyScore.toFixed(2)}`
          : `대기: 점수 ${buyScore.toFixed(2)}, 체결대금 ${formatTradeValue(tradeValue)}`,
        buyScore,
        sellScore,
        buyImbalanceRate,
        sellImbalanceRate,
        upTickRate,
        consecutiveUpTicks: normalizedConsecutiveUpTicks,
        tradeValue,
        spreadRate,
        expectedRequiredRate,
        volatilityRate,
      };
    },
    [
      candles,
      hasSelectedMarketWarning,
      normalizedMarket,
      orderChanceConstraints.askFeeRate,
      orderChanceConstraints.bidFeeRate,
      orderChanceConstraints.minTotalKrw,
      selectedOrderbook,
      strategy,
      strategyPosition,
      tickStrategyStats.consecutiveLosses,
      tickStrategyStats.realizedPnlRate,
    ],
  );

  const checkStrategy = useCallback(
    async (nextTicker: Ticker) => {
      if (!running) {
        return;
      }

      resetDailyStrategyOrderCount();
      const price = Number(nextTicker.trade_price);
      const cooldownMs = Math.max(Number(strategy.cooldownSec) || 0, 1) * 1000;
      const elapsed = Date.now() - lastTradeAtRef.current;

      if (elapsed < cooldownMs) {
        return;
      }

      if (strategy.mode === "tick") {
        if (!dryRunRef.current) {
          setRunning(false);
          addLog("error", "틱 신호 전략은 주문 상태 추적 구현 전까지 모의 실행에서만 사용할 수 있습니다.");
          return;
        }

        const maxDailyOrders = Math.floor(parsePositiveNumber(strategy.maxDailyOrders, 20));
        if (strategyOrderCountRef.current.count >= maxDailyOrders) {
          setTickStrategyStatus({
            action: "wait",
            reason: "일일 주문 횟수 제한 도달",
            buyScore: 0,
            sellScore: 0,
            buyImbalanceRate: 0,
            sellImbalanceRate: 0,
            upTickRate: 0,
            consecutiveUpTicks: 0,
            tradeValue: 0,
            spreadRate: selectedOrderbook?.spread_rate ?? 0,
            expectedRequiredRate: 0,
            volatilityRate: calculateCandleVolatility(candles),
          });
          return;
        }

        const status = buildTickStrategyStatus(nextTicker);
        setTickStrategyStatus(status);

        if (status.action === "buy") {
          lastTradeAtRef.current = Date.now();
          const entryPrice = selectedOrderbook?.best_ask_price || nextTicker.trade_price;
          const quoteAmount = parsePositiveNumber(strategy.buyKrw, 0);
          await invokeOrder({
            market: normalizedMarket,
            side: "bid",
            price: strategy.buyKrw,
            ord_type: "price",
            identifier: `tickbuy${Date.now().toString(36).slice(-12)}`,
          });
          setStrategyPosition({
            market: normalizedMarket,
            entryPrice,
            volume: entryPrice > 0 ? quoteAmount / entryPrice : 0,
            quoteAmount,
            enteredAt: Date.now(),
          });
          strategyOrderCountRef.current.count += 1;
          addLog("info", `틱 전략 가상 진입: ${normalizedMarket} ${formatMarketPrice(normalizedMarket, entryPrice)}`);
          return;
        }

        if (status.action === "sell" && strategyPosition?.market === normalizedMarket) {
          lastTradeAtRef.current = Date.now();
          const exitPrice = selectedOrderbook?.best_bid_price || nextTicker.trade_price;
          const configuredFeeRate = percentInputToRate(strategy.feeRate, 0.05);
          const bidFeeRate = orderChanceConstraints.bidFeeRate ?? configuredFeeRate;
          const askFeeRate = orderChanceConstraints.askFeeRate ?? configuredFeeRate;
          const slippageRate = percentInputToRate(strategy.slippageRate, 0.03);
          const grossPnl = (exitPrice - strategyPosition.entryPrice) * strategyPosition.volume;
          const cost =
            strategyPosition.quoteAmount * bidFeeRate +
            exitPrice * strategyPosition.volume * (askFeeRate + slippageRate);
          const netPnl = grossPnl - cost;
          await invokeOrder({
            market: normalizedMarket,
            side: "ask",
            volume: strategyPosition.volume.toFixed(8),
            ord_type: "market",
            identifier: `ticksell${Date.now().toString(36).slice(-11)}`,
          });
          setStrategyPosition(null);
          strategyOrderCountRef.current.count += 1;
          setTickStrategyStats((current) => {
            const nextRealizedPnl = current.realizedPnl + netPnl;
            const baseAmount = Math.max(parsePositiveNumber(strategy.maxExposureKrw, strategyPosition.quoteAmount), 1);
            const isWin = netPnl >= 0;
            return {
              ...current,
              trades: current.trades + 1,
              wins: current.wins + (isWin ? 1 : 0),
              losses: current.losses + (isWin ? 0 : 1),
              consecutiveLosses: isWin ? 0 : current.consecutiveLosses + 1,
              realizedPnl: nextRealizedPnl,
              realizedPnlRate: nextRealizedPnl / baseAmount,
            };
          });
          addLog("info", `틱 전략 가상 청산: ${normalizedMarket}, 순손익 ${formatTradeValue(netPnl)}`);
        }
        return;
      }

      const buyBelow = Number(strategy.buyBelow);
      const sellAbove = Number(strategy.sellAbove);

      if (strategy.buyBelow.trim() !== "" && price <= buyBelow) {
        lastTradeAtRef.current = Date.now();
        await invokeOrder({
          market: normalizedMarket,
          side: "bid",
          price: strategy.buyKrw,
          ord_type: "price",
        });
        return;
      }

      if (strategy.sellAbove.trim() !== "" && price >= sellAbove) {
        if (strategy.sellVolume.trim() === "") {
          addLog("warn", "매도 조건은 충족됐지만 매도 수량이 비어 있습니다.");
          return;
        }

        lastTradeAtRef.current = Date.now();
        await invokeOrder({
          market: normalizedMarket,
          side: "ask",
          volume: strategy.sellVolume,
          ord_type: "market",
        });
      }
    },
    [
      addLog,
      buildTickStrategyStatus,
      candles,
      invokeOrder,
      normalizedMarket,
      orderChanceConstraints.askFeeRate,
      orderChanceConstraints.bidFeeRate,
      resetDailyStrategyOrderCount,
      running,
      selectedOrderbook,
      strategy,
      strategyPosition,
    ],
  );

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      const nextTicker = await refreshTicker();
      await checkStrategy(nextTicker);
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }, [addLog, checkStrategy, refreshTicker]);

  useEffect(() => {
    setManualOrder((current) => ({ ...current, market: normalizedMarket }));
    setTickStrategyStatus(null);
  }, [normalizedMarket]);

  useEffect(() => {
    refreshMarkets();
  }, [refreshMarkets]);

  useEffect(() => {
    refreshMarketTickers();
  }, [refreshMarketTickers]);

  useEffect(() => {
    const timer = window.setInterval(refreshMarketTickers, MARKET_TICKER_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshMarketTickers]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlistenSnapshot: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    WebviewWindow.getCurrent()
      .listen("trade-volume-snapshot", (event) => {
        const payload = event.payload;
        if (!Array.isArray(payload)) {
          return;
        }

        setTradeVolumes((current) => {
          const next = { ...current };
          for (const item of payload) {
            if (!isRecord(item) || typeof item.market !== "string") {
              continue;
            }

            const marketCode = item.market.trim().toUpperCase();
            if (!marketCode.startsWith("KRW-")) {
              continue;
            }

            const accumulatedTradeValue = Number(item.accumulated_trade_value) || 0;
            const accumulatedBidTradeValue = Number(item.accumulated_bid_trade_value) || 0;
            const accumulatedAskTradeValue = Number(item.accumulated_ask_trade_value) || 0;
            const tradeCount = Number(item.trade_count) || 0;
            const price = Number(item.last_trade_price) || 0;
            const previousTotals = lastTradeSnapshotTotalsRef.current[marketCode];
            if (previousTotals && price > 0) {
              const tradeValueDelta = Math.max(accumulatedTradeValue - previousTotals.tradeValue, 0);
              const bidTradeValueDelta = Math.max(accumulatedBidTradeValue - previousTotals.bidTradeValue, 0);
              const askTradeValueDelta = Math.max(accumulatedAskTradeValue - previousTotals.askTradeValue, 0);
              const tradeCountDelta = Math.max(tradeCount - previousTotals.tradeCount, 0);
              if (tradeValueDelta > 0 || tradeCountDelta > 0) {
                tradeSignalSamplesRef.current.push({
                  market: marketCode,
                  at: Date.now(),
                  price,
                  tradeValue: tradeValueDelta,
                  bidTradeValue: bidTradeValueDelta,
                  askTradeValue: askTradeValueDelta,
                  tradeCount: tradeCountDelta,
                  direction: price > previousTotals.price ? "up" : price < previousTotals.price ? "down" : "flat",
                });
                const cutoff = Date.now() - 180_000;
                tradeSignalSamplesRef.current = tradeSignalSamplesRef.current.filter((sample) => sample.at >= cutoff);
              }
            }

            lastTradeSnapshotTotalsRef.current[marketCode] = {
              tradeValue: accumulatedTradeValue,
              bidTradeValue: accumulatedBidTradeValue,
              askTradeValue: accumulatedAskTradeValue,
              tradeCount,
              price,
            };

            next[marketCode] = {
              market: marketCode,
              last_trade_price: price,
              last_trade_volume: Number(item.last_trade_volume) || 0,
              accumulated_volume: Number(item.accumulated_volume) || 0,
              accumulated_trade_value: accumulatedTradeValue,
              accumulated_bid_volume: Number(item.accumulated_bid_volume) || 0,
              accumulated_ask_volume: Number(item.accumulated_ask_volume) || 0,
              accumulated_bid_trade_value: accumulatedBidTradeValue,
              accumulated_ask_trade_value: accumulatedAskTradeValue,
              trade_count: tradeCount,
              last_trade_timestamp:
                typeof item.last_trade_timestamp === "number" ? item.last_trade_timestamp : null,
              ask_bid: typeof item.ask_bid === "string" ? item.ask_bid : null,
            };
          }
          return next;
        });
      })
      .then((nextUnlisten) => {
        unlistenSnapshot = nextUnlisten;
      });

    WebviewWindow.getCurrent()
      .listen("trade-volume-status", (event) => {
        if (typeof event.payload === "string" && event.payload !== "체결 WebSocket 연결됨") {
          addLog("warn", event.payload);
        }
      })
      .then((nextUnlisten) => {
        unlistenStatus = nextUnlisten;
      });

    return () => {
      unlistenSnapshot?.();
      unlistenStatus?.();
    };
  }, [addLog]);

  useEffect(() => {
    if (krwMarketCodes.length === 0 || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    setTradeVolumes({});
    void invoke("start_trade_volume_stream", { markets: krwMarketCodes }).catch((error) => {
      addLog("error", String(error));
    });

    return () => {
      void invoke("stop_trade_volume_stream");
    };
  }, [addLog, krwMarketCodes]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlistenSnapshot: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    WebviewWindow.getCurrent()
      .listen("orderbook-snapshot", (event) => {
        const item = event.payload;
        if (!isRecord(item) || typeof item.market !== "string") {
          return;
        }

        const marketCode = item.market.trim().toUpperCase();
        if (!marketCode.startsWith("KRW-")) {
          return;
        }

        setOrderbooks((current) => ({
          ...current,
          [marketCode]: {
            market: marketCode,
            best_ask_price: Number(item.best_ask_price) || 0,
            best_bid_price: Number(item.best_bid_price) || 0,
            best_ask_size: Number(item.best_ask_size) || 0,
            best_bid_size: Number(item.best_bid_size) || 0,
            total_ask_size: Number(item.total_ask_size) || 0,
            total_bid_size: Number(item.total_bid_size) || 0,
            spread: Number(item.spread) || 0,
            spread_rate: Number(item.spread_rate) || 0,
            received_at: Number(item.received_at) || Date.now(),
            exchange_timestamp: typeof item.exchange_timestamp === "number" ? item.exchange_timestamp : null,
          },
        }));
      })
      .then((nextUnlisten) => {
        unlistenSnapshot = nextUnlisten;
      });

    WebviewWindow.getCurrent()
      .listen("orderbook-status", (event) => {
        if (typeof event.payload === "string" && event.payload !== "호가 WebSocket 연결됨") {
          addLog("warn", event.payload);
        }
      })
      .then((nextUnlisten) => {
        unlistenStatus = nextUnlisten;
      });

    return () => {
      unlistenSnapshot?.();
      unlistenStatus?.();
    };
  }, [addLog]);

  useEffect(() => {
    if (!isMarketCode(normalizedMarket) || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    setOrderbooks((current) => {
      const selected = current[normalizedMarket];
      return selected ? { [normalizedMarket]: selected } : {};
    });
    void invoke("start_orderbook_stream", { market: normalizedMarket }).catch((error) => {
      addLog("error", String(error));
    });

    return () => {
      void invoke("stop_orderbook_stream");
    };
  }, [addLog, normalizedMarket]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, {
      autoSize: true,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#4d5c66",
      },
      grid: {
        vertLines: { color: "#eef2f5" },
        horzLines: { color: "#eef2f5" },
      },
      rightPriceScale: {
        borderColor: "#d8e0e6",
      },
      timeScale: {
        borderColor: "#d8e0e6",
        timeVisible: true,
        secondsVisible: true,
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#c43d34",
      downColor: "#1d62a7",
      borderVisible: false,
      wickUpColor: "#c43d34",
      wickDownColor: "#1d62a7",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.setData(candles);
    if (candles.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  useEffect(() => {
    refreshCandles();
  }, [refreshCandles]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCandles({ showLoading: false });
    }, CHART_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshCandles]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!running) {
      return;
    }

    const intervalSec = Math.max(Number(strategy.intervalSec) || 10, 3);
    const timer = window.setInterval(refreshAll, intervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [refreshAll, running, strategy.intervalSec]);

  const headline = useMemo(() => {
    if (!ticker) {
      return "시세 대기";
    }

    return `${numberFormat.format(ticker.trade_price)} KRW`;
  }, [ticker]);

  async function handleRefreshPrivateData() {
    setBusy(true);
    try {
      await refreshPrivateData();
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenAssetWindow() {
    if (!isKeyReady) {
      addLog("warn", "자산 창을 열려면 계좌 API 연동이 필요합니다.");
      return;
    }

    setBusy(true);
    try {
      const existingWindow = await WebviewWindow.getByLabel(ASSET_WINDOW_LABEL);
      if (existingWindow) {
        await existingWindow.emit("asset-session-updated", null);
        await existingWindow.show();
        await existingWindow.setFocus();
      } else {
        const assetWindow = new WebviewWindow(ASSET_WINDOW_LABEL, {
          url: "/#/assets",
          title: "Autobo 자산",
          width: 760,
          height: 560,
          minWidth: 620,
          minHeight: 420,
          focus: true,
        });
        assetWindow.once("tauri://error", (event) => {
          addLog("error", `자산 창 생성 실패: ${String(event.payload)}`);
        });
      }

      addLog("info", "자산 창을 열었습니다.");
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleResetUserPreferences() {
    clearUserPreferences();
    setMarket(defaultUserPreferences.market);
    setDryRun(defaultUserPreferences.dryRun);
    setMarketSearch(defaultUserPreferences.marketSearch);
    setMarketSort({ ...defaultUserPreferences.marketSort });
    setChartTimeframe(defaultUserPreferences.chartTimeframe);
    setStrategy({ ...defaultUserPreferences.strategy });
    setManualOrder({ ...defaultUserPreferences.manualOrder });
    addLog("info", "화면 설정을 기본값으로 초기화했습니다.");
  }

  async function handleManualOrder() {
    setBusy(true);
    try {
      await invokeOrder({
        ...manualOrder,
        market: manualOrder.market.trim().toUpperCase(),
        volume: manualOrder.volume?.trim() || null,
        price: manualOrder.price?.trim() || null,
        identifier: manualOrder.identifier?.trim() || null,
        time_in_force: manualOrder.time_in_force?.trim() || null,
      });
    } catch (error) {
      addLog("error", String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <span className="eyebrow">Upbit Desktop Trader</span>
          <h1>Autobo</h1>
        </div>
        <div className="status-strip">
          <span className={dryRun ? "pill warning" : "pill danger"}>
            {dryRun ? "모의 실행" : "실거래"}
          </span>
          <span className={running ? "pill active" : "pill"}>{running ? "자동 감시 중" : "정지"}</span>
        </div>
      </section>

      <section className="market-band">
        <div className="quote">
          <label htmlFor="market">마켓</label>
          <input
            id="market"
            value={market}
            onChange={(event) => setMarket(event.currentTarget.value)}
            onBlur={() =>
              setMarket((value) => {
                const nextMarket = value.trim().toUpperCase();
                return isMarketCode(nextMarket) ? nextMarket : "KRW-BTC";
              })
            }
          />
        </div>
        <div className="price-tile">
          <span>현재가</span>
          <strong>{headline}</strong>
          {ticker ? (
            <em className={ticker.signed_change_price >= 0 ? "up" : "down"}>
              {ticker.signed_change_price >= 0 ? "+" : ""}
              {numberFormat.format(ticker.signed_change_price)} ({percentFormat.format(ticker.signed_change_rate * 100)}%)
            </em>
          ) : (
            <em>조회 전</em>
          )}
        </div>
        <div className="price-tile">
          <span>24h 거래대금</span>
          <strong>{ticker ? `${numberFormat.format(Math.round(ticker.acc_trade_price_24h))} KRW` : "-"}</strong>
          <em>{ticker ? formatTradeVolume(normalizedMarket, ticker.acc_trade_volume_24h) : "-"}</em>
        </div>
        <div className="price-tile">
          <span>실시간 체결량</span>
          <strong>{selectedTradeVolume ? formatTradeVolume(normalizedMarket, selectedTradeVolume.accumulated_volume) : "-"}</strong>
          <em>{selectedTradeVolume ? formatTradeValue(selectedTradeVolume.accumulated_trade_value) : "WebSocket 대기"}</em>
        </div>
        <button className="icon-button" type="button" disabled={busy} onClick={refreshAll}>
          <RefreshCw size={18} />
          갱신
        </button>
      </section>

      <section className="market-chart-grid">
        <article className="panel market-list-panel">
          <div className="panel-title">
            <BarChart3 size={18} />
            <h2>마켓 목록</h2>
          </div>
          <label>
            종목 검색
            <input
              value={marketSearch}
              placeholder="코드, 한글명, 영문명"
              onChange={(event) => setMarketSearch(event.currentTarget.value)}
            />
          </label>
          <div className="segmented-control" aria-label="마켓 보기">
            <button
              className={showFavoritesOnly ? "selected" : ""}
              type="button"
              aria-pressed={showFavoritesOnly}
              onClick={() => setShowFavoritesOnly((value) => !value)}
            >
              <Star size={14} fill={showFavoritesOnly ? "currentColor" : "none"} />
              즐겨찾기
            </button>
          </div>
          <div className="sort-control" aria-label="종목 정렬">
            <button
              className={marketSort.mode === "tradeValue" ? "selected" : ""}
              type="button"
              aria-pressed={marketSort.mode === "tradeValue"}
              onClick={() => toggleMarketSort("tradeValue")}
            >
              실시간 거래대금 {marketSort.mode === "tradeValue" && marketSort.direction === "asc" ? "낮은 순" : "높은 순"}
            </button>
            <button
              className={marketSort.mode === "price" ? "selected" : ""}
              type="button"
              aria-pressed={marketSort.mode === "price"}
              onClick={() => toggleMarketSort("price")}
            >
              현재가 {marketSort.mode === "price" && marketSort.direction === "asc" ? "낮은 순" : "높은 순"}
            </button>
            <button
              className={marketSort.mode === "changeRate" ? "selected" : ""}
              type="button"
              aria-pressed={marketSort.mode === "changeRate"}
              onClick={() => toggleMarketSort("changeRate")}
            >
              {marketSort.mode === "changeRate" && marketSort.direction === "asc" ? "하락률 높은 순" : "상승률 높은 순"}
            </button>
          </div>
          <div className="market-list-meta">
            <span>
              {marketsLoading
                ? "불러오는 중"
                : showFavoritesOnly
                  ? `${filteredMarkets.length} / ${favoriteMarkets.length}개 즐겨찾기`
                  : `KRW ${filteredMarkets.length} / ${markets.length}개`}
            </span>
            <button className="text-button" type="button" disabled={marketsLoading} onClick={refreshMarkets}>
              <RefreshCw size={15} />
              새로고침
            </button>
          </div>
          <div className="market-list">
            {marketsError ? (
              <div className="state-box error">{marketsError}</div>
            ) : marketsLoading && markets.length === 0 ? (
              <div className="state-box">마켓 목록을 불러오는 중입니다.</div>
            ) : filteredMarkets.length === 0 ? (
              <div className="state-box">{emptyMarketMessage}</div>
            ) : (
              filteredMarkets.map((item) => {
                const itemTicker = marketTickers[item.market];
                const itemTradeVolume = tradeVolumes[item.market];
                const isFavorite = favoriteMarketSet.has(item.market);

                return (
                  <div className="market-row-shell" key={item.market}>
                    <button
                      className={`favorite-button ${isFavorite ? "selected" : ""}`}
                      type="button"
                      aria-label={`${item.market} 즐겨찾기 ${isFavorite ? "해제" : "추가"}`}
                      aria-pressed={isFavorite}
                      onClick={(event) => toggleMarketFavorite(event, item.market)}
                    >
                      <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
                    </button>
                    <button
                      className={`market-row ${item.market === normalizedMarket ? "selected" : ""} ${isFavorite ? "favorite" : ""}`}
                      type="button"
                      onClick={() => setMarket(item.market)}
                    >
                      <span>
                        <strong>{item.korean_name}</strong>
                        <em>{item.english_name}</em>
                      </span>
                      <span className="market-row-meta">
                        <strong className={itemTicker ? (itemTicker.signed_change_price >= 0 ? "up" : "down") : ""}>
                          {itemTicker ? formatMarketPrice(item.market, itemTicker.trade_price) : "-"}
                        </strong>
                        <em className={itemTicker ? (itemTicker.signed_change_price >= 0 ? "up" : "down") : ""}>
                          {itemTicker ? `${itemTicker.signed_change_rate >= 0 ? "+" : ""}${percentFormat.format(itemTicker.signed_change_rate * 100)}%` : "-"}
                        </em>
                        <em>{itemTradeVolume ? formatTradeValue(itemTradeVolume.accumulated_trade_value) : "실시간 대기"}</em>
                        <em>{itemTradeVolume ? formatTradeVolume(item.market, itemTradeVolume.accumulated_volume) : "-"}</em>
                        <code>{item.market}</code>
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="chart-panel-header">
            <div className="panel-title">
              <BarChart3 size={18} />
              <h2>{selectedMarketInfo?.korean_name ?? normalizedMarket}</h2>
            </div>
            <div className="chart-heading-meta">
              <span>{selectedMarketInfo?.english_name ?? "선택 종목"}</span>
              {hasSelectedMarketWarning ? <span className="pill warning">주의</span> : null}
              <code>{normalizedMarket}</code>
            </div>
          </div>
          <div className="chart-toolbar">
            <div className="timeframe-buttons" aria-label="차트 주기">
              {chartTimeframes.map((item) => (
                <button
                  className={chartTimeframe === item.value ? "selected" : ""}
                  key={item.value}
                  type="button"
                  aria-pressed={chartTimeframe === item.value}
                  onClick={() => setChartTimeframe(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="text-button" type="button" disabled={chartLoading} onClick={() => refreshCandles()}>
              <RefreshCw size={15} />
              {selectedTimeframeLabel} 갱신
            </button>
          </div>
          <div className="chart-frame">
            <div className="chart-container" ref={chartContainerRef} />
            {chartLoading ? <div className="chart-state">캔들을 불러오는 중입니다.</div> : null}
            {!chartLoading && chartError ? <div className="chart-state error">{chartError}</div> : null}
            {!chartLoading && !chartError && candles.length === 0 ? (
              <div className="chart-state">표시할 캔들 데이터가 없습니다.</div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel credentials">
          <div className="panel-title">
            <KeyRound size={18} />
            <h2>계좌 API</h2>
          </div>
          <div className={`state-box account-state ${accountStatus}`}>
            {accountStatus === "checking"
              ? "upbitkey 파일을 확인하는 중입니다."
              : accountStatus === "linked"
                ? "연동되었습니다"
                : "계좌 연동에 실패했습니다"}
          </div>
          <label className="switch">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.currentTarget.checked)} />
            <span>주문 모의 실행</span>
          </label>
          <button className="secondary-button" type="button" disabled={busy || !isKeyReady} onClick={handleRefreshPrivateData}>
            <Wallet size={17} />
            잔고/주문 가능정보 조회
          </button>
          <button className="secondary-button" type="button" disabled={busy || !isKeyReady} onClick={handleOpenAssetWindow}>
            <Wallet size={17} />
            자산 창 열기
          </button>
          <button className="subtle-button" type="button" onClick={handleResetUserPreferences}>
            <RotateCcw size={16} />
            화면 설정 초기화
          </button>
          <p className="note">
            실행 파일과 같은 폴더의 upbitkey 파일에서 API 키를 읽으며, 화면 설정과 입력값만 이 기기에 저장됩니다.
          </p>
        </article>

        <article className="panel strategy">
          <div className="panel-title">
            <Activity size={18} />
            <h2>자동 전략</h2>
          </div>
          <div className="segmented-control" aria-label="자동 전략 모드">
            <button
              className={strategy.mode === "price" ? "selected" : ""}
              type="button"
              aria-pressed={strategy.mode === "price"}
              onClick={() => setStrategy((current) => ({ ...current, mode: "price" }))}
            >
              가격 조건
            </button>
            <button
              className={strategy.mode === "tick" ? "selected" : ""}
              type="button"
              aria-pressed={strategy.mode === "tick"}
              onClick={() => setStrategy((current) => ({ ...current, mode: "tick" }))}
            >
              틱 신호
            </button>
          </div>
          {strategy.mode === "price" ? (
            <div className="form-grid">
              <label>
                감시 주기(초)
                <input
                  value={strategy.intervalSec}
                  inputMode="numeric"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, intervalSec: value }));
                  }}
                />
              </label>
              <label>
                쿨다운(초)
                <input
                  value={strategy.cooldownSec}
                  inputMode="numeric"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, cooldownSec: value }));
                  }}
                />
              </label>
              <label>
                이하 매수 기준가
                <input
                  value={strategy.buyBelow}
                  inputMode="decimal"
                  placeholder="예: 90000000"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, buyBelow: value }));
                  }}
                />
              </label>
              <label>
                매수 금액(KRW)
                <input
                  value={strategy.buyKrw}
                  inputMode="decimal"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, buyKrw: value }));
                  }}
                />
              </label>
              <label>
                이상 매도 기준가
                <input
                  value={strategy.sellAbove}
                  inputMode="decimal"
                  placeholder="예: 110000000"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, sellAbove: value }));
                  }}
                />
              </label>
              <label>
                매도 수량
                <input
                  value={strategy.sellVolume}
                  inputMode="decimal"
                  placeholder="예: 0.001"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setStrategy((current) => ({ ...current, sellVolume: value }));
                  }}
                />
              </label>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  감시 주기(초)
                  <input
                    value={strategy.intervalSec}
                    inputMode="numeric"
                    onChange={(event) => setStrategy((current) => ({ ...current, intervalSec: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  쿨다운(초)
                  <input
                    value={strategy.cooldownSec}
                    inputMode="numeric"
                    onChange={(event) => setStrategy((current) => ({ ...current, cooldownSec: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  매수 금액(KRW)
                  <input
                    value={strategy.buyKrw}
                    inputMode="decimal"
                    onChange={(event) => setStrategy((current) => ({ ...current, buyKrw: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  틱 윈도우(초)
                  <input
                    value={strategy.tickWindowSec}
                    inputMode="numeric"
                    onChange={(event) => setStrategy((current) => ({ ...current, tickWindowSec: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  모멘텀 틱 수
                  <input
                    value={strategy.momentumTicks}
                    inputMode="numeric"
                    onChange={(event) => setStrategy((current) => ({ ...current, momentumTicks: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  매수 체결 비율(%)
                  <input
                    value={strategy.buyImbalanceThreshold}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, buyImbalanceThreshold: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  매도 체결 비율(%)
                  <input
                    value={strategy.sellImbalanceThreshold}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, sellImbalanceThreshold: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  상승 틱 비율(%)
                  <input
                    value={strategy.upTickRatioThreshold}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, upTickRatioThreshold: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  최소 체결대금(KRW)
                  <input
                    value={strategy.minTradeValueKrw}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, minTradeValueKrw: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  최소 주문금액(KRW)
                  <input
                    value={strategy.minOrderKrw}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, minOrderKrw: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  1회 포지션 한도(KRW)
                  <input
                    value={strategy.maxPositionKrw}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, maxPositionKrw: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  전체 노출 한도(KRW)
                  <input
                    value={strategy.maxExposureKrw}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, maxExposureKrw: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  최소 변동성(%)
                  <input
                    value={strategy.minVolatilityRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, minVolatilityRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  최대 스프레드(%)
                  <input
                    value={strategy.maxSpreadRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, maxSpreadRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  익절(%)
                  <input
                    value={strategy.takeProfitRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, takeProfitRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  손절(%)
                  <input
                    value={strategy.stopLossRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, stopLossRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  일일 손실 제한(%)
                  <input
                    value={strategy.dailyStopLossRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, dailyStopLossRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  연속 손실 제한
                  <input
                    value={strategy.lossStreakLimit}
                    inputMode="numeric"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, lossStreakLimit: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  최대 보유(초)
                  <input
                    value={strategy.maxHoldingSec}
                    inputMode="numeric"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, maxHoldingSec: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  일일 주문 제한
                  <input
                    value={strategy.maxDailyOrders}
                    inputMode="numeric"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, maxDailyOrders: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  수수료/편도(%)
                  <input
                    value={strategy.feeRate}
                    inputMode="decimal"
                    onChange={(event) => setStrategy((current) => ({ ...current, feeRate: event.currentTarget.value }))}
                  />
                </label>
                <label>
                  슬리피지(%)
                  <input
                    value={strategy.slippageRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, slippageRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  안전 마진(%)
                  <input
                    value={strategy.safetyMarginRate}
                    inputMode="decimal"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, safetyMarginRate: event.currentTarget.value }))
                    }
                  />
                </label>
                <label>
                  데이터 지연 제한(초)
                  <input
                    value={strategy.staleDataSec}
                    inputMode="numeric"
                    onChange={(event) =>
                      setStrategy((current) => ({ ...current, staleDataSec: event.currentTarget.value }))
                    }
                  />
                </label>
              </div>
              <div className="strategy-metrics">
                <span>상태</span>
                <strong>{tickStrategyStatus?.reason ?? "틱 신호 대기"}</strong>
                <span>매수 점수</span>
                <strong>{tickStrategyStatus ? tickStrategyStatus.buyScore.toFixed(2) : "-"}</strong>
                <span>매수/매도 체결</span>
                <strong>
                  {tickStrategyStatus
                    ? `${formatRate(tickStrategyStatus.buyImbalanceRate)} / ${formatRate(tickStrategyStatus.sellImbalanceRate)}`
                    : "-"}
                </strong>
                <span>상승 틱</span>
                <strong>
                  {tickStrategyStatus
                    ? `${formatRate(tickStrategyStatus.upTickRate)} / 연속 ${tickStrategyStatus.consecutiveUpTicks}`
                    : "-"}
                </strong>
                <span>스프레드</span>
                <strong>{selectedOrderbook ? formatRate(selectedOrderbook.spread_rate) : "호가 대기"}</strong>
                <span>주문 가능정보</span>
                <strong>
                  {orderChanceConstraints.minTotalKrw
                    ? `최소 ${formatTradeValue(orderChanceConstraints.minTotalKrw)}`
                    : "수동 비용 설정 사용"}
                </strong>
                <span>검증 손익</span>
                <strong>
                  {`${formatTradeValue(tickStrategyStats.realizedPnl)} / ${formatRate(tickStrategyStats.realizedPnlRate)}`}
                </strong>
                <span>승/패</span>
                <strong>{`${tickStrategyStats.wins}/${tickStrategyStats.losses}, 연속손실 ${tickStrategyStats.consecutiveLosses}`}</strong>
                <span>가상 포지션</span>
                <strong>
                  {strategyPosition?.market === normalizedMarket
                    ? `${formatMarketPrice(normalizedMarket, strategyPosition.entryPrice)} / ${strategyPosition.volume.toFixed(8)}`
                    : "없음"}
                </strong>
              </div>
            </>
          )}
          <div className="button-row">
            <button
              className={running ? "danger-button" : "primary-button"}
              type="button"
              onClick={() => {
                setRunning((value) => !value);
                addLog(running ? "warn" : "info", running ? "자동 감시를 정지했습니다." : "자동 감시를 시작했습니다.");
              }}
            >
              {running ? <Square size={17} /> : <Play size={17} />}
              {running ? "정지" : "시작"}
            </button>
          </div>
          <p className="note">
            가격 조건은 기존 주문 경로를 사용합니다. 틱 신호는 체결/호가 기반 dry-run 전용 가상 포지션으로 먼저 검증합니다.
          </p>
        </article>

        <article className="panel manual">
          <div className="panel-title">
            <Send size={18} />
            <h2>수동 주문</h2>
          </div>
          <div className="preset-control" aria-label="수동 주문 프리셋">
            <button
              className={activeManualOrderPreset === "limit" ? "selected" : ""}
              type="button"
              aria-pressed={activeManualOrderPreset === "limit"}
              onClick={() => applyManualOrderPreset("limit")}
            >
              <ListChecks size={15} />
              지정가
            </button>
            <button
              className={activeManualOrderPreset === "marketBuy" ? "selected" : ""}
              type="button"
              aria-pressed={activeManualOrderPreset === "marketBuy"}
              onClick={() => applyManualOrderPreset("marketBuy")}
            >
              <ListChecks size={15} />
              시장가 매수
            </button>
            <button
              className={activeManualOrderPreset === "marketSell" ? "selected" : ""}
              type="button"
              aria-pressed={activeManualOrderPreset === "marketSell"}
              onClick={() => applyManualOrderPreset("marketSell")}
            >
              <ListChecks size={15} />
              시장가 매도
            </button>
          </div>
          <div className="form-grid">
            <label>
              side
              <select
                value={manualOrder.side}
                onChange={(event) => {
                  const value = event.currentTarget.value as OrderRequest["side"];
                  setManualOrder((current) => ({ ...current, side: value }));
                }}
              >
                <option value="bid">bid 매수</option>
                <option value="ask">ask 매도</option>
              </select>
            </label>
            <label>
              ord_type
              <select
                value={manualOrder.ord_type}
                onChange={(event) => {
                  const value = event.currentTarget.value as OrderRequest["ord_type"];
                  setManualOrder((current) => ({
                    ...current,
                    ord_type: value,
                  }));
                }}
              >
                <option value="limit">limit 지정가</option>
                <option value="price">price 시장가 매수</option>
                <option value="market">market 시장가 매도</option>
                <option value="best">best 최유리</option>
              </select>
            </label>
            <label>
              가격/매수금액
              <input
                value={manualOrder.price ?? ""}
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setManualOrder((current) => ({ ...current, price: value }));
                }}
              />
            </label>
            <label>
              수량
              <input
                value={manualOrder.volume ?? ""}
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setManualOrder((current) => ({ ...current, volume: value }));
                }}
              />
            </label>
            <label>
              identifier
              <input
                value={manualOrder.identifier ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setManualOrder((current) => ({ ...current, identifier: value }));
                }}
              />
            </label>
            <label>
              time_in_force
              <select
                value={manualOrder.time_in_force ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setManualOrder((current) => ({ ...current, time_in_force: value }));
                }}
              >
                <option value="">없음</option>
                <option value="ioc">ioc</option>
                <option value="fok">fok</option>
                <option value="post_only">post_only</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="button" disabled={busy || (!dryRun && !isKeyReady)} onClick={handleManualOrder}>
            <Send size={17} />
            주문 전송
          </button>
        </article>

        <article className="panel risk">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <h2>실거래 체크</h2>
          </div>
          <ul className="checklist">
            <li>기본값은 모의 실행이며, 실거래 전 체크박스를 해제해야 합니다.</li>
            <li>API Key는 필요한 권한만 부여하고 허용 IP를 등록하세요.</li>
            <li>전략은 단순 가격 조건입니다. 슬리피지, 수수료, 체결 지연은 별도 검증이 필요합니다.</li>
          </ul>
          <div className="warning-box">
            <AlertTriangle size={18} />
            <span>자동매매는 손실이 발생할 수 있습니다. 작은 금액과 모의 실행으로 먼저 검증하세요.</span>
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel output-panel">
          <div className="panel-title">
            <BarChart3 size={18} />
            <h2>최근 응답</h2>
          </div>
          <div className="output-tabs">
            <pre>
              {compactJson({
                ticker,
                orderbook: selectedOrderbook,
                tickStrategyStatus,
                strategyPosition,
                tickStrategyStats,
                orderChanceConstraints,
                accounts,
                chance,
                lastOrder,
              })}
            </pre>
          </div>
        </article>

        <article className="panel log-panel">
          <div className="panel-title">
            <Activity size={18} />
            <h2>로그</h2>
          </div>
          <div className="logs">
            {logs.length === 0 ? (
              <span className="empty">아직 로그가 없습니다.</span>
            ) : (
              logs.map((log) => (
                <div className={`log-line ${log.level}`} key={log.id}>
                  <time>{log.at}</time>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
