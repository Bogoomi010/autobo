/**
 * [파트 C] 업비트 API Key 입력 모달 (도트 감성).
 * EV.OPEN_KEY_MODAL 수신 시 열림 — 첫 실행(저장된 키 없음)과 키 변경에 공용.
 * 입력한 키는 Rust에서 잔고 조회로 검증 후 ROOT 폴더에 암호화 저장(upbitkey.enc)된다.
 * ⚠ 키 값은 로그·토스트·오류 메시지에 그대로 노출하지 않는다.
 */
import { bus, EV } from "../game/events";
import { store } from "../game/state";

export function initKeyModal(): void {
  const ui = document.getElementById("ui")!;

  // ── DOM 골격 ───────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "keyModal";

  const panel = document.createElement("div");
  panel.className = "km-panel pixel-panel";

  const title = document.createElement("div");
  title.className = "km-title";
  title.textContent = "🔑 업비트 계좌 연동";

  const desc = document.createElement("div");
  desc.className = "km-desc";
  desc.textContent =
    "업비트 Open API Key를 입력하면 실계좌가 연동돼요. 키는 이 PC의 앱 폴더에 암호화되어 저장됩니다.";

  const accessLabel = document.createElement("label");
  accessLabel.textContent = "Access Key";
  const accessInput = document.createElement("input");
  accessInput.type = "text";
  accessInput.placeholder = "업비트에서 발급받은 Access Key";
  accessInput.autocomplete = "off";
  accessInput.spellcheck = false;
  accessLabel.append(accessInput);

  const secretLabel = document.createElement("label");
  secretLabel.textContent = "Secret Key";
  const secretInput = document.createElement("input");
  secretInput.type = "password"; // 화면 노출 방지
  secretInput.placeholder = "업비트에서 발급받은 Secret Key";
  secretInput.autocomplete = "off";
  secretLabel.append(secretInput);

  const error = document.createElement("div");
  error.className = "km-error";

  const note = document.createElement("div");
  note.className = "km-note";
  note.textContent =
    "· 자산조회/주문 권한과 이 PC의 IP가 허용된 키가 필요해요. 키는 서버로 전송되지 않아요.";

  const actions = document.createElement("div");
  actions.className = "km-actions";
  const laterBtn = document.createElement("button");
  laterBtn.className = "pixel-btn wood";
  laterBtn.textContent = "나중에";
  const saveBtn = document.createElement("button");
  saveBtn.className = "pixel-btn";
  saveBtn.textContent = "저장하고 연동";
  actions.append(laterBtn, saveBtn);

  panel.append(title, desc, accessLabel, secretLabel, error, note, actions);
  overlay.append(panel);
  ui.append(overlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let busy = false; // 검증/저장 중 — 닫기·중복 제출 잠금

  function setBusy(on: boolean): void {
    busy = on;
    saveBtn.disabled = on;
    laterBtn.disabled = on;
    accessInput.disabled = on;
    secretInput.disabled = on;
    saveBtn.textContent = on ? "연동 중…" : "저장하고 연동";
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
    accessInput.value = "";
    secretInput.value = "";
    clearError();
    setBusy(false);
    overlay.classList.add("open");
    setTimeout(() => accessInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen || busy) return;
    isOpen = false;
    // 입력값을 DOM에 남기지 않는다
    accessInput.value = "";
    secretInput.value = "";
    overlay.classList.remove("open");
  }

  // ── 제출 ───────────────────────────────────────────────────
  async function submit(): Promise<void> {
    if (busy) return;
    const accessKey = accessInput.value.trim();
    const secretKey = secretInput.value.trim();
    if (!accessKey || !secretKey) {
      showError("Access Key와 Secret Key를 모두 입력하세요.");
      (accessKey ? secretInput : accessInput).focus();
      return;
    }

    clearError();
    setBusy(true);
    try {
      await store.connectWithKeys(accessKey, secretKey);
      setBusy(false);
      close();
      bus.emit(EV.TOAST, "🔑 계좌 연동 완료! 키를 안전하게 저장했어요", "good");
    } catch (e) {
      setBusy(false);
      showError(String(e));
      secretInput.focus();
    }
  }

  saveBtn.addEventListener("click", () => void submit());
  laterBtn.addEventListener("click", close);
  overlay.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void submit();
    if (ev.key === "Escape") close();
    ev.stopPropagation(); // 게임 캔버스로 키 입력 전파 차단
  });
  // 바깥 클릭으로 닫기 (검증 중 제외)
  overlay.addEventListener("pointerdown", (ev) => {
    if (ev.target === overlay) close();
  });

  bus.on(EV.OPEN_KEY_MODAL, open);
}
