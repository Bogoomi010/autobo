/**
 * 매수봇 생성 창 — 봇마다 독립적인 예산(금액)/동작 시간대/익절·손절 퍼센트를 입력받는다.
 * EV.OPEN_BOT_CREATE_MODAL 수신 시 열리고, 확정하면 botEngine.addBot(settings)을 직접 호출한다.
 */
import noUiSlider from "nouislider";
import "nouislider/dist/nouislider.css";
import { botEngine } from "../bots/botEngine";
import { BOT_MAX_BUDGET_KRW, BOT_TYPE_LABEL, DEFAULT_BOT_SETTINGS, type BotSettings, type BotType } from "../bots/types";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";

const QUICK_BUDGETS = [500, 1_000, 1_500, BOT_MAX_BUDGET_KRW];
const MIN_BUDGET_KRW = 500; // 원금 상한(BOT_MAX_BUDGET_KRW=2,000원) 안에서 고르게 하는 하한

const BOT_TYPE_OPTIONS: { type: BotType; text: string }[] = [
  { type: "scalp", text: `⚡ ${BOT_TYPE_LABEL.scalp} (최대 24시간 보유)` },
  { type: "longterm", text: `🌱 ${BOT_TYPE_LABEL.longterm} (최소 24시간 보유)` },
];

// 동작 시간대 — "시작 시각"과 "지속 시간"을 각각 자기 폭 전체를 쓰는 슬라이더로 나눠 받는다.
// (시작~시작+지속 두 값을 한 슬라이더의 두 손잡이로 합치면 30분처럼 짧은 구간은
//  하루 두 바퀴(48h) 축 위에서 폭이 거의 안 보여 드래그하기 어려워진다 — 그래서 분리한다)
// 시작이 몇 시든 지속시간을 최대 24시간까지 주면 자정을 넘어 익일로 넘어가는 구간도 그대로 표현된다
// (예: 시작 00:00 + 지속 24시간 → "00:00 ~ 00:00").
const DAY_MIN = 1440;
const TIME_STEP = 10; // 기존 분(minute) select와 동일한 10분 단위

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 시작 슬라이더 값(0~1430) → "HH:MM" */
function fmtStart(raw: number | string): string {
  const t = Math.round(Number(raw) / TIME_STEP) * TIME_STEP;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/** 지속시간 슬라이더 값(10~1440) → "N시간 M분" (24시간이면 "24시간") */
function fmtDuration(raw: number | string): string {
  const t = Math.round(Number(raw) / TIME_STEP) * TIME_STEP;
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function initBotCreateModal(): void {
  const ui = document.getElementById("ui")!;

  const overlay = document.createElement("div");
  overlay.id = "botCreateModal";

  const panel = document.createElement("div");
  panel.className = "bcm-panel pixel-panel";

  const title = document.createElement("div");
  title.className = "bcm-title";
  title.textContent = "🤖 매수봇 생성";

  const desc = document.createElement("div");
  desc.className = "bcm-desc";
  desc.textContent = "이 봇 전용 예산·동작 시간대·익절/손절 기준을 정해요.";

  // 봇 종류
  const typeLabel = document.createElement("div");
  typeLabel.className = "bcm-section-label";
  typeLabel.textContent = "봇 종류";

  const typeRow = document.createElement("div");
  typeRow.className = "bcm-quick";
  const typeButtons = new Map<BotType, HTMLButtonElement>();
  for (const opt of BOT_TYPE_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt.text;
    b.addEventListener("click", () => setBotType(opt.type));
    typeButtons.set(opt.type, b);
    typeRow.append(b);
  }

  // 금액
  const budgetLabel = document.createElement("label");
  budgetLabel.textContent = "매수 예산 (1회, KRW)";
  const budgetInput = document.createElement("input");
  budgetInput.type = "text";
  budgetInput.inputMode = "numeric";
  budgetInput.autocomplete = "off";
  budgetLabel.append(budgetInput);

  const budgetQuick = document.createElement("div");
  budgetQuick.className = "bcm-quick";
  for (const amt of QUICK_BUDGETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pixel-btn tiny wood";
    b.textContent = krw(amt);
    b.addEventListener("click", () => setBudget(amt));
    budgetQuick.append(b);
  }

  // 동작 시간대
  const timeLabel = document.createElement("div");
  timeLabel.className = "bcm-section-label";
  timeLabel.textContent = "동작 시간대 (KST, 평일만)";

  const timeRow = document.createElement("div");
  timeRow.className = "bcm-time-row";

  const startBlock = document.createElement("div");
  startBlock.className = "bcm-slider-block";
  const startBlockLabel = document.createElement("div");
  startBlockLabel.className = "bcm-slider-label";
  startBlockLabel.textContent = "시작 시각";
  const startSliderEl = document.createElement("div");
  startSliderEl.className = "bcm-time-slider";
  startBlock.append(startBlockLabel, startSliderEl);

  const durationBlock = document.createElement("div");
  durationBlock.className = "bcm-slider-block";
  const durationBlockLabel = document.createElement("div");
  durationBlockLabel.className = "bcm-slider-label";
  durationBlockLabel.textContent = "지속 시간";
  const durationSliderEl = document.createElement("div");
  durationSliderEl.className = "bcm-time-slider";
  durationBlock.append(durationBlockLabel, durationSliderEl);

  timeRow.append(startBlock, durationBlock);

  const numFormat = { to: (v: number) => String(Math.round(v)), from: (v: string) => Number(v) };
  const startSlider = noUiSlider.create(startSliderEl, {
    start: [0],
    behaviour: "drag",
    range: { min: 0, max: DAY_MIN - TIME_STEP },
    step: TIME_STEP,
    tooltips: [{ to: fmtStart, from: Number }],
    format: numFormat,
  });
  const durationSlider = noUiSlider.create(durationSliderEl, {
    start: [DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes],
    behaviour: "drag",
    range: { min: TIME_STEP, max: DAY_MIN },
    step: TIME_STEP,
    tooltips: [{ to: fmtDuration, from: Number }],
    format: numFormat,
  });

  const timePreview = document.createElement("div");
  timePreview.className = "bcm-time-preview";

  const timeHint = document.createElement("div");
  timeHint.className = "bcm-desc";

  // 익절/손절 퍼센트
  const pctRow = document.createElement("div");
  pctRow.className = "bcm-pct-row";
  const tpLabel = document.createElement("label");
  tpLabel.textContent = "익절 %";
  const tpInput = document.createElement("input");
  tpInput.type = "number";
  tpInput.step = "0.1";
  tpInput.min = "0.1";
  tpLabel.append(tpInput);
  const slLabel = document.createElement("label");
  slLabel.textContent = "손절 %";
  const slInput = document.createElement("input");
  slInput.type = "number";
  slInput.step = "0.1";
  slInput.min = "0.1";
  slLabel.append(slInput);
  pctRow.append(tpLabel, slLabel);

  const error = document.createElement("div");
  error.className = "bcm-error";

  const actions = document.createElement("div");
  actions.className = "bcm-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "pixel-btn wood";
  cancelBtn.textContent = "취소";
  const createBtn = document.createElement("button");
  createBtn.className = "pixel-btn";
  createBtn.textContent = "🤖 생성";
  actions.append(cancelBtn, createBtn);

  panel.append(
    title,
    desc,
    typeLabel,
    typeRow,
    budgetLabel,
    budgetQuick,
    timeLabel,
    timeRow,
    timePreview,
    timeHint,
    pctRow,
    error,
    actions
  );
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let budget = DEFAULT_BOT_SETTINGS.budgetKrw;
  let botType: BotType = DEFAULT_BOT_SETTINGS.botType;
  let scanStartHour = DEFAULT_BOT_SETTINGS.scanWindow.startHourKst;
  let scanStartMinute = DEFAULT_BOT_SETTINGS.scanWindow.startMinute;
  let scanDurationMinutes = DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes;

  // 슬라이더 값 변경 → 상태로 반영 — 프로그램적 set()에도 동일하게 호출된다
  startSlider.on("update", (values) => {
    const startTotal = Number(values[0]);
    scanStartHour = Math.floor(startTotal / 60);
    scanStartMinute = startTotal % 60;
    renderTimePreview();
  });
  durationSlider.on("update", (values) => {
    scanDurationMinutes = Number(values[0]);
    renderTimePreview();
  });

  function setBudget(v: number): void {
    budget = Math.max(0, Math.min(BOT_MAX_BUDGET_KRW, Math.floor(v)));
    budgetInput.value = budget > 0 ? budget.toLocaleString("ko-KR") : "";
  }

  function setBotType(next: BotType): void {
    botType = next;
    for (const [t, btn] of typeButtons) btn.className = t === botType ? "pixel-btn" : "pixel-btn wood";
    timeHint.textContent =
      botType === "scalp"
        ? "이 시간이 끝나면 보유 중인 포지션도 강제로 매도돼요."
        : "매수 스캔에만 적용돼요. 매도는 최소 24시간 보유 후 익절/손절 기준을 따라요.";
  }

  function renderTimePreview(): void {
    const endTotal = scanStartHour * 60 + scanStartMinute + scanDurationMinutes;
    const endH = Math.floor(endTotal / 60) % 24;
    const endM = endTotal % 60;
    timePreview.textContent = `${pad2(scanStartHour)}:${pad2(scanStartMinute)} ~ ${pad2(endH)}:${pad2(endM)} (평일)`;
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.classList.add("on");
  }

  function clearError(): void {
    error.textContent = "";
    error.classList.remove("on");
  }

  function resetForm(): void {
    setBotType(DEFAULT_BOT_SETTINGS.botType);
    setBudget(DEFAULT_BOT_SETTINGS.budgetKrw);
    // "update" 리스너가 상태/프리뷰까지 같이 갱신
    startSlider.set(DEFAULT_BOT_SETTINGS.scanWindow.startHourKst * 60 + DEFAULT_BOT_SETTINGS.scanWindow.startMinute);
    durationSlider.set(DEFAULT_BOT_SETTINGS.scanWindow.durationMinutes);
    tpInput.value = String(DEFAULT_BOT_SETTINGS.takeProfitRate * 100);
    slInput.value = String(DEFAULT_BOT_SETTINGS.stopLossRate * 100);
  }

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    clearError();
    resetForm();
    overlay.classList.add("open");
    setTimeout(() => budgetInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("open");
  }

  function readSettings(): BotSettings | null {
    if (budget < MIN_BUDGET_KRW) {
      showError(`예산은 최소 ${krw(MIN_BUDGET_KRW)} 이상이어야 해요.`);
      return null;
    }
    const takeProfitPct = Number(tpInput.value);
    if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
      showError("익절 %는 0보다 커야 해요.");
      return null;
    }
    const stopLossPct = Number(slInput.value);
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
      showError("손절 %는 0보다 커야 해요.");
      return null;
    }
    return {
      botType,
      budgetKrw: budget,
      takeProfitRate: takeProfitPct / 100,
      stopLossRate: stopLossPct / 100,
      scanWindow: {
        startHourKst: scanStartHour,
        startMinute: scanStartMinute,
        durationMinutes: scanDurationMinutes,
      },
    };
  }

  function submit(): void {
    clearError();
    const settings = readSettings();
    if (!settings) return;
    botEngine.addBot(settings);
    bus.emit(EV.TOAST, "🤖 새 매수봇을 생성했어요", "good");
    close();
  }

  // ── 입력 ───────────────────────────────────────────────────
  budgetInput.addEventListener("input", () => {
    clearError();
    const digits = budgetInput.value.replace(/[^0-9]/g, "");
    setBudget(digits ? Number(digits) : 0);
  });
  createBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") close();
    e.stopPropagation(); // 게임 캔버스로 키 입력 전파 차단
  });

  bus.on(EV.OPEN_BOT_CREATE_MODAL, open);
}
