/**
 * 금고 출금 모달 (도트 감성) — 기존 ◀/▶ 키보드 셀렉터를 대체.
 * 빠른 금액 버튼 + 직접 입력으로 원하는 금액을 자유롭게 출금할 수 있다.
 * EV.OPEN_WITHDRAW_MODAL 수신 시 열림 → 닫힐 때 EV.WITHDRAW_MODAL_CLOSED 를 1회 방송한다.
 */
import { sfx } from "../core/sfx";
import { bus, EV } from "../game/events";
import { krw } from "../game/format";
import { store } from "../game/state";

const QUICK_AMOUNTS = [10_000, 50_000, 100_000, 500_000, 1_000_000];

export function initWithdrawModal(): void {
  const ui = document.getElementById("ui")!;

  const overlay = document.createElement("div");
  overlay.id = "withdrawModal";

  const panel = document.createElement("div");
  panel.className = "wm-panel pixel-panel";

  const title = document.createElement("div");
  title.className = "wm-title";
  title.textContent = "🔐 금고에서 꺼내기";

  const balance = document.createElement("div");
  balance.className = "wm-balance";

  const amountInput = document.createElement("input");
  amountInput.id = "wmAmount";
  amountInput.type = "text";
  amountInput.inputMode = "numeric";
  amountInput.autocomplete = "off";
  amountInput.placeholder = "꺼낼 금액";

  const quickRow = document.createElement("div");
  quickRow.className = "wm-quick";
  for (const amt of QUICK_AMOUNTS) {
    const b = document.createElement("button");
    b.className = "pixel-btn tiny wood";
    b.textContent = `+${krw(amt).replace("₩", "")}`;
    b.addEventListener("click", () => setAmount(amount + amt));
    quickRow.append(b);
  }
  const allBtn = document.createElement("button");
  allBtn.className = "pixel-btn tiny coral";
  allBtn.textContent = "전액";
  allBtn.addEventListener("click", () => setAmount(store.vaultBalance()));
  const resetBtn = document.createElement("button");
  resetBtn.className = "pixel-btn tiny wood";
  resetBtn.textContent = "초기화";
  resetBtn.addEventListener("click", () => setAmount(0));
  quickRow.append(allBtn, resetBtn);

  const preview = document.createElement("div");
  preview.className = "wm-preview";

  const error = document.createElement("div");
  error.className = "wm-error";

  const actions = document.createElement("div");
  actions.className = "wm-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "pixel-btn wood";
  cancelBtn.textContent = "취소";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "pixel-btn";
  confirmBtn.textContent = "💵 꺼내기";
  actions.append(cancelBtn, confirmBtn);

  panel.append(title, balance, amountInput, quickRow, preview, error, actions);
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let amount = 0;

  function maxAmount(): number {
    return Math.max(0, store.vaultBalance());
  }

  function clamp(v: number): number {
    return Math.max(0, Math.min(Math.floor(v), maxAmount()));
  }

  function setAmount(v: number): void {
    amount = clamp(v);
    amountInput.value = amount > 0 ? amount.toLocaleString("ko-KR") : "";
    renderPreview();
  }

  function renderPreview(): void {
    const max = maxAmount();
    confirmBtn.disabled = amount <= 0 || amount > max;
    if (amount <= 0) {
      preview.textContent = "꺼낼 금액을 선택하거나 입력하세요";
      preview.classList.remove("ready");
    } else {
      preview.innerHTML = `<b class="num">${krw(amount)}</b> 꺼내기 → 금고 잔액 <span class="num">${krw(max - amount)}</span>`;
      preview.classList.add("ready");
    }
  }

  function renderBalance(): void {
    balance.innerHTML = `금고 잔액 <b class="num">${krw(maxAmount())}</b>`;
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.classList.add("on");
  }

  function clearError(): void {
    error.textContent = "";
    error.classList.remove("on");
  }

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    clearError();
    overlay.classList.add("open");
    renderBalance();
    if (maxAmount() < 1) {
      setAmount(0);
      showError("금고가 비었어요…");
    } else {
      setAmount(Math.min(100_000, maxAmount()));
    }
    setTimeout(() => amountInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove("open");
    bus.emit(EV.WITHDRAW_MODAL_CLOSED);
  }

  function confirm(): void {
    if (amount <= 0 || amount > maxAmount()) return;
    if (!store.withdraw(amount)) {
      showError("출금에 실패했어요. 금액을 확인하세요.");
      return;
    }
    sfx.gacha();
    close();
  }

  // ── 입력 ───────────────────────────────────────────────────
  amountInput.addEventListener("input", () => {
    clearError();
    const digits = amountInput.value.replace(/[^0-9]/g, "");
    setAmount(digits ? Number(digits) : 0);
  });

  confirmBtn.addEventListener("click", confirm);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") close();
    e.stopPropagation(); // 게임 캔버스로 키 입력 전파 차단
  });

  // 배경 자산(잔액)이 바뀌면(실거래 계좌 갱신 등) 최대치를 재클램프
  bus.on(EV.WALLET, () => {
    if (!isOpen) return;
    renderBalance();
    setAmount(amount);
  });

  bus.on(EV.OPEN_WITHDRAW_MODAL, open);
}
