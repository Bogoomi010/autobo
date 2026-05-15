# 편의 기능 구현 결과: 수동 주문 도우미

## 구현 내용

- 수동 주문 패널에 주문 도우미 영역을 추가했다.
- 선택 마켓의 현재가를 가격 입력값으로 채우는 `현재가 입력` 버튼을 추가했다.
- 10,000 / 50,000 / 100,000 KRW 빠른 금액 버튼을 추가했다.
- 지정가 주문은 금액과 가격으로 주문 수량을 자동 계산한다.
- 시장가 매수는 빠른 금액을 매수 금액으로 입력한다.
- 시장가 매도는 현재가 기준으로 해당 금액만큼의 수량을 계산한다.
- 주문 전 마켓, 현재가, 예상 주문액, 기준 자산을 요약 표시한다.
- 수동 주문 전송 전에 주문 유형별 필수 입력과 side/ord_type 조합을 검증한다.
- 검증 실패 시 API 호출 전에 로그 경고를 남기고 전송을 중단한다.

## 변경 파일

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-order-assist-plan.md`
- `docs/convenience-order-assist-result.md`

## 검증 결과

- `.\node_modules\.bin\tsc.cmd`: 통과
- `.\node_modules\.bin\vite.cmd build --configLoader runner`: 통과
- `cargo check` in `src-tauri`: 통과

## 검증 특이사항

- 기본 `npm` 래퍼가 `C:\Users\kbk56\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`를 찾지 못해 `npm run build`가 직접 실행되지 않았다.
- 이 worktree에는 `node_modules`가 없어, 같은 writable root의 `D:\Workspace\repo_autobo\node_modules`를 일시적으로 junction 연결해 검증했다.
- Vite 기본 config bundler는 sandbox 상위 경로 접근 제한으로 실패했으므로 `--configLoader runner` 옵션으로 동일한 production build를 수행했다.
- 검증용 junction, 부분 설치 산출물, `dist` 산출물은 정리했다.
