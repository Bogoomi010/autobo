/** ₩1,234,567 형식 */
export function krw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

/** 1234만 / 12.3만 같은 축약 표기 (머리 위 셀렉터 등 좁은 곳용) */
export function krwShort(n: number): string {
  const man = n / 10_000;
  if (man >= 10_000) return `${(man / 10_000).toFixed(1)}억`;
  return `${man % 1 === 0 ? man : man.toFixed(1)}만`;
}

/** +3.1% / -0.4% (부호 포함) */
export function pct(rate: number): string {
  const v = rate * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** 코인 현재가 표기 — 업비트 관례(1000 미만은 소수 표시) */
export function coinPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("ko-KR");
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
