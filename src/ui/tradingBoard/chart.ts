import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import type { Candle } from "../../game/types";

/** 캔들+거래량 차트 인스턴스 — board.ts가 마켓/타임프레임 전환 시 setData, 실시간 틱마다 updateLast를 호출한다 */
export interface PriceChart {
  setData(candles: Candle[]): void;
  updateLast(candle: Candle): void;
  resize(): void;
  destroy(): void;
}

const UP_COLOR = "#d24f45";
const DOWN_COLOR = "#1261c4";

/** 캔들 하나를 lightweight-charts 캔들스틱 데이터 포맷으로 변환 */
function toCandlestickPoint(candle: Candle) {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

/** 캔들 하나를 lightweight-charts 거래량 히스토그램 데이터 포맷으로 변환 (상승=빨강/하락=파랑) */
function toVolumePoint(candle: Candle) {
  return {
    time: candle.time as UTCTimestamp,
    value: candle.volume,
    color: candle.close >= candle.open ? UP_COLOR : DOWN_COLOR,
  };
}

/** container 안에 업비트 스타일 캔들스틱+거래량 차트를 생성한다 */
export function createPriceChart(container: HTMLElement): PriceChart {
  const chart: IChartApi = createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: "#ffffff" },
      textColor: "#1e2329",
    },
    grid: {
      vertLines: { color: "#f2f4f6" },
      horzLines: { color: "#f2f4f6" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: "#ebeef1",
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
      borderColor: "#ebeef1",
      // 최신 캔들이 항상 오른쪽 끝에 붙어 있도록 고정 — 그 너머(미래 방향)로는 스크롤/줌 불가.
      // 새 캔들이 추가될 때(updateLast)도 오른쪽 끝이 보이고 있었다면 자동으로 따라가며 갱신된다.
      rightOffset: 2,
      fixRightEdge: true,
      shiftVisibleRangeOnNewBar: true,
    },
  });

  const candleSeries: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
  });

  const volumeSeries: ISeriesApi<"Histogram"> = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "coin-office-volume",
  });
  // 거래량 패널은 차트 하단 20%에만 표시하고 위쪽 80%는 캔들에 비워준다
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);

  function resize(): void {
    chart.resize(container.clientWidth, container.clientHeight);
  }

  function setData(candles: Candle[]): void {
    candleSeries.setData(candles.map(toCandlestickPoint));
    volumeSeries.setData(candles.map(toVolumePoint));
    chart.timeScale().fitContent();
  }

  function updateLast(candle: Candle): void {
    candleSeries.update(toCandlestickPoint(candle));
    volumeSeries.update(toVolumePoint(candle));
  }

  function destroy(): void {
    resizeObserver.disconnect();
    chart.remove();
  }

  return { setData, updateLast, resize, destroy };
}
