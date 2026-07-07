import type { SaveData } from "../game/types";

/**
 * 로컬 세이브 — localStorage 사용.
 * Tauri(WebView2)에서도 앱 데이터 폴더에 영속되므로 별도 Rust 커맨드가 필요 없다.
 * 잔고 등 돈의 원본은 항상 업비트 계좌이며, 여기엔 게임 상태(포지션·돈뭉치)만 둔다.
 */

const SAVE_KEY = "coin_office";

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("save failed:", e);
  }
}
