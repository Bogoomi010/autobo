/** UI 공용 헬퍼 (HUD·모달·Phaser 월드 UI 공유) */

/** 심볼 문자열 해시 → 0~359 색상(hue), badgeColor/badgeColorHex가 공유하는 결정적 해시 */
function hueHash(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function hslToHex(h: number, s: number, l: number): number {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}

/** 심볼 문자열 해시 → 파스텔 배경색 (뱃지용, 결정적) */
export function badgeColor(symbol: string): string {
  return `hsl(${hueHash(symbol)}, 62%, 78%)`;
}

/** badgeColor와 동일한 색을 Phaser 등 캔버스 컨텍스트에서 쓸 0xRRGGBB 정수로 반환 */
export function badgeColorHex(symbol: string): number {
  return hslToHex(hueHash(symbol), 62, 78);
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
