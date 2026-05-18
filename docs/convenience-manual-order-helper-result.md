# 편의 기능 구현 결과: 수동 주문 금액 도우미

## 구현 내용

- 수동 주문 카드에 `주문 도우미` 영역을 추가했다.
- 선택 종목의 현재가를 수동 주문 가격 입력값으로 채우는 버튼을 추가했다.
- 시장가 매수용 빠른 금액 버튼을 추가했다.
  - 1만원 매수
  - 5만원 매수
  - 10만원 매수
- 주문 방식과 입력값에 따라 예상 주문 규모를 표시하도록 했다.
  - 시장가 매수: 예상 매수 수량
  - 시장가 매도: 예상 매도 금액
  - 지정가/기타 가격 주문: 예상 주문 금액
- 작은 화면에서도 버튼과 계산 카드가 한 줄에 과밀하게 배치되지 않도록 반응형 스타일을 추가했다.
- Vite가 샌드박스 상위 디렉터리를 탐색하다 실패하지 않도록 `npm run build`에서 `--configLoader runner`를 사용하게 했다.

## 변경 파일

- `package.json`
- `src/App.tsx`
- `src/App.css`
- `docs/convenience-manual-order-helper-plan.md`
- `docs/convenience-manual-order-helper-result.md`

## 검증 결과

- `node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" install`: 통과
- `node "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run build`: 통과
- `cargo check` in `src-tauri`: 통과
- `git push -u origin automation/order-quote-helper`: 실패
  - 현재 환경에서 `github.com:443`에 연결할 수 없어 푸시와 PR 생성을 진행하지 못했다.

## 테스트 비고

- `package.json`에는 별도 테스트 스크립트가 없다.
- 기본 `npm` 래퍼는 사용자 npm CLI 경로를 잘못 참조해 실패했으므로, 시스템 Node에 포함된 npm CLI를 직접 호출해 검증했다.
- Browser 플러그인의 로컬 URL 접근이 보안 정책으로 차단되어 화면 렌더링 검증은 수행하지 못했다.
