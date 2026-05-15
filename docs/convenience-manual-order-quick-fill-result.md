# 편의 기능 구현 결과: 수동 주문 빠른 입력

## 구현 내용

- 수동 주문 패널에 빠른 입력 영역을 추가했다.
- 시장가 매수 금액을 10,000원, 50,000원, 100,000원 버튼으로 채울 수 있게 했다.
- 주문 가능정보의 `bid_account`, `ask_account` 잔고를 안전하게 읽어 가능 잔고 25%, 50%, 100%를 주문 입력값으로 반영하게 했다.
- 지정가 주문에서는 현재가 기준으로 금액을 수량으로 환산해 `price`와 `volume`을 같이 채우게 했다.
- 주문 가능 잔고와 선택 마켓의 기준/대상 통화를 빠른 입력 영역에 표시했다.
- API Key, 주문 전송, 자동 전략 로직은 변경하지 않았다.

## 검증 결과

- `node node_modules\\typescript\\bin\\tsc -p tsconfig.json`: 통과
- `node node_modules\\vite\\bin\\vite.js build --configLoader runner`: 통과
- `cargo check` in `src-tauri`: 통과
- `cargo test` in `src-tauri`: 통과, 2개 테스트 성공

## 비고

- 현재 환경의 `npm` 래퍼가 `C:\\Users\\kbk56\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js`를 찾지 못해 `npm run build`는 직접 실행할 수 없었다.
- `node_modules`는 주 작업 사본 `D:\\Workspace\\repo_autobo`의 설치본을 junction으로 연결해 동일한 TypeScript/Vite 도구를 직접 실행했다.
- Vite 기본 config loader는 worktree 경로 권한 문제로 실패해 `--configLoader runner` 옵션을 사용했다.
- 원격 푸시는 GitHub 네트워크 연결 실패로 완료하지 못했다.
