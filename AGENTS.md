# Agent Instructions

## 빌드 규칙

- 항상 작업이 끝난 뒤에는 `npm run build`가 아닌 `npm run tauri build`를 진행합니다.

이 프로젝트에서 작업할 때는 코드 변경 전에 `docs` 경로의 문서를 먼저 확인한다.

## 필수 참조 문서

- `docs/upbit-api-implementation-notes.md`
  - Upbit API 전역 구현 주의사항
  - 인증, JWT, `query_hash`, rate limit, REST/WebSocket 에러 처리
  - Tauri 구조에서 API Key와 API 호출을 다루는 원칙

- `docs/upbit-endpoint-catalog.md`
  - Upbit REST API 엔드포인트별 구현 메모
  - Quotation, Exchange, 주문, 입출금, 서비스 정보 API
  - endpoint별 path, 권한, rate limit, 파라미터, 구현 주의사항

## 작업 원칙

- Upbit API 연동 코드를 작성하거나 수정하기 전에는 위 문서를 확인한다.
- 공식 문서와 로컬 `docs` 내용이 충돌하면 공식 문서를 다시 확인하고 `docs`를 갱신한다.
- 인증이 필요한 API는 React 프론트엔드에서 직접 호출하지 않고 Tauri Rust 백엔드에서 처리한다.
- API Key, JWT, 계정 정보, 주문/입출금 응답의 민감 정보는 로그와 UI에 그대로 노출하지 않는다.
- 주문, 입금, 출금처럼 자산 이동이 발생하는 기능은 dry-run, 테스트 API, 명시적 사용자 확인, 권한 분리를 우선한다.
- 자동매매 전략 코드에서 입금/출금 요청 API를 직접 호출하지 않는다.
- rate limit은 endpoint 단위가 아니라 Upbit 문서의 rate limit group 기준으로 설계한다.
- `query_hash`가 필요한 요청은 실제 요청 파라미터와 해시 입력 문자열의 순서와 구성을 일치시킨다.
