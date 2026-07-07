/** UI 공용 헬퍼 (HUD·모달 공유) */

/** 심볼 문자열 해시 → 파스텔 배경색 (뱃지용, 결정적) */
export function badgeColor(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 62%, 78%)`;
}

/** 코인 뱃지 요소 생성 — 심볼 앞 1~2글자 + 파스텔 배경 */
export function makeBadge(symbol: string): HTMLDivElement {
  const b = document.createElement("div");
  b.className = "badge";
  b.textContent = symbol.slice(0, symbol.length >= 4 ? 2 : symbol.length).toUpperCase();
  b.style.background = badgeColor(symbol);
  return b;
}

/** 등락률/손익 부호에 따른 색상 클래스 ("up"=빨강 상승 / "down"=파랑 하락) */
export function signClass(rate: number): string {
  if (rate > 0) return "up";
  if (rate < 0) return "down";
  return "";
}
