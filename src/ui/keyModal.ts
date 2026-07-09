/**
 * [파트 C] 업비트 API Key 입력 모달 (도트 감성).
 * EV.OPEN_KEY_MODAL 수신 시 열림 — 첫 실행(저장된 키 없음)과 키 변경에 공용.
 * 입력한 프로필/키는 Rust에서 잔고 조회로 검증 후 ROOT 폴더에 암호화 저장(upbitkey.enc)된다.
 * ⚠ 키 값은 로그·토스트·오류 메시지에 그대로 노출하지 않는다.
 */
import { bus, EV } from "../game/events";
import { store } from "../game/state";
import type { ApiKeyProfileSummary } from "../api/upbit";

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
    "프로필 닉네임과 업비트 Open API Key를 입력하면 실계좌가 연동돼요. 키는 이 PC의 앱 폴더에 암호화되어 저장됩니다.";

  const nicknameLabel = document.createElement("label");
  nicknameLabel.textContent = "프로필 닉네임";
  const nicknameInput = document.createElement("input");
  nicknameInput.type = "text";
  nicknameInput.placeholder = "예: 개인 계정, 테스트 키";
  nicknameInput.autocomplete = "off";
  nicknameInput.maxLength = 24;
  nicknameInput.spellcheck = false;
  nicknameLabel.append(nicknameInput);

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

  panel.append(title, desc, nicknameLabel, accessLabel, secretLabel, error, note, actions);
  overlay.append(panel);
  ui.append(overlay);

  // ── 저장된 프로필 선택 모달 ───────────────────────────────
  const profileOverlay = document.createElement("div");
  profileOverlay.id = "profileModal";

  const profilePanel = document.createElement("div");
  profilePanel.className = "pm-panel pixel-panel";

  const profileTitle = document.createElement("div");
  profileTitle.className = "pm-title";
  profileTitle.textContent = "실거래 프로필 선택";

  const profileDesc = document.createElement("div");
  profileDesc.className = "pm-desc";
  profileDesc.textContent = "연동할 업비트 키 프로필을 선택하세요.";

  const profileList = document.createElement("div");
  profileList.className = "pm-list";

  const profileError = document.createElement("div");
  profileError.className = "pm-error";

  const profileActions = document.createElement("div");
  profileActions.className = "pm-actions";
  const newProfileBtn = document.createElement("button");
  newProfileBtn.className = "pixel-btn";
  newProfileBtn.textContent = "새 프로필";
  const profileLaterBtn = document.createElement("button");
  profileLaterBtn.className = "pixel-btn wood";
  profileLaterBtn.textContent = "나중에";
  profileActions.append(newProfileBtn, profileLaterBtn);

  profilePanel.append(profileTitle, profileDesc, profileList, profileError, profileActions);
  profileOverlay.append(profilePanel);
  ui.append(profileOverlay);

  // ── 상태 ───────────────────────────────────────────────────
  let isOpen = false;
  let isProfileOpen = false;
  let busy = false; // 검증/저장 중 — 닫기·중복 제출 잠금

  function setBusy(on: boolean): void {
    busy = on;
    saveBtn.disabled = on;
    laterBtn.disabled = on;
    nicknameInput.disabled = on;
    accessInput.disabled = on;
    secretInput.disabled = on;
    saveBtn.textContent = on ? "연동 중…" : "저장하고 연동";
  }

  function setProfileBusy(on: boolean): void {
    busy = on;
    for (const btn of profileOverlay.querySelectorAll<HTMLButtonElement>("button")) {
      btn.disabled = on;
    }
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.classList.add("on");
  }

  function clearError(): void {
    error.textContent = "";
    error.classList.remove("on");
  }

  function showProfileError(msg: string): void {
    profileError.textContent = msg;
    profileError.classList.add("on");
  }

  function clearProfileError(): void {
    profileError.textContent = "";
    profileError.classList.remove("on");
  }

  // ── 열기/닫기 ──────────────────────────────────────────────
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    nicknameInput.value = "";
    accessInput.value = "";
    secretInput.value = "";
    clearError();
    setBusy(false);
    overlay.classList.add("open");
    setTimeout(() => nicknameInput.focus(), 0);
  }

  function close(): void {
    if (!isOpen || busy) return;
    isOpen = false;
    // 입력값을 DOM에 남기지 않는다
    nicknameInput.value = "";
    accessInput.value = "";
    secretInput.value = "";
    overlay.classList.remove("open");
  }

  function openProfiles(profiles: ApiKeyProfileSummary[]): void {
    if (isProfileOpen) return;
    isProfileOpen = true;
    clearProfileError();
    setProfileBusy(false);
    renderProfiles(profiles);
    profileOverlay.classList.add("open");
  }

  function closeProfiles(): void {
    if (!isProfileOpen || busy) return;
    isProfileOpen = false;
    profileOverlay.classList.remove("open");
    profileList.replaceChildren();
  }

  function renderProfiles(profiles: ApiKeyProfileSummary[]): void {
    profileList.replaceChildren();
    for (const profile of profiles) {
      const btn = document.createElement("button");
      btn.className = "pm-row";
      btn.type = "button";

      const name = document.createElement("span");
      name.className = "pm-name";
      name.textContent = profile.nickname;

      const hint = document.createElement("span");
      hint.className = "pm-hint";
      hint.textContent = profile.accessKeyHint;

      btn.append(name, hint);
      btn.addEventListener("click", () => void selectProfile(profile));
      profileList.append(btn);
    }
  }

  async function selectProfile(profile: ApiKeyProfileSummary): Promise<void> {
    if (busy) return;
    clearProfileError();
    setProfileBusy(true);
    try {
      await store.connectWithProfile(profile.id);
      setProfileBusy(false);
      closeProfiles();
      bus.emit(EV.TOAST, `${profile.nickname} 프로필로 계좌를 연동했어요`, "good");
    } catch (e) {
      setProfileBusy(false);
      showProfileError(String(e));
    }
  }

  // ── 제출 ───────────────────────────────────────────────────
  async function submit(): Promise<void> {
    if (busy) return;
    const nickname = nicknameInput.value.trim();
    const accessKey = accessInput.value.trim();
    const secretKey = secretInput.value.trim();
    if (!nickname) {
      showError("프로필 닉네임을 입력하세요.");
      nicknameInput.focus();
      return;
    }
    if (!accessKey || !secretKey) {
      showError("Access Key와 Secret Key를 모두 입력하세요.");
      (accessKey ? secretInput : accessInput).focus();
      return;
    }

    clearError();
    setBusy(true);
    try {
      await store.connectWithKeys(nickname, accessKey, secretKey);
      setBusy(false);
      close();
      bus.emit(EV.TOAST, `${nickname} 프로필 저장 및 계좌 연동 완료`, "good");
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

  newProfileBtn.addEventListener("click", () => {
    closeProfiles();
    open();
  });
  profileLaterBtn.addEventListener("click", closeProfiles);
  profileOverlay.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeProfiles();
    ev.stopPropagation();
  });
  profileOverlay.addEventListener("pointerdown", (ev) => {
    if (ev.target === profileOverlay) closeProfiles();
  });

  bus.on(EV.OPEN_KEY_MODAL, open);
  bus.on(EV.OPEN_PROFILE_MODAL, (profiles: ApiKeyProfileSummary[]) => openProfiles(profiles));
}
