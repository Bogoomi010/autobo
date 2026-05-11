# Upbit API 구현 주의사항

확인일: 2026-05-11

이 문서는 Autobo에서 Upbit Open API를 연동할 때 코드 작업자가 반드시 확인해야 할 구현 주의사항을 정리한다. 아래 공식 문서를 기준으로 작성했다.

- [개요](https://docs.upbit.com/kr/reference/api-overview)
- [인증](https://docs.upbit.com/kr/reference/auth)
- [요청 수 제한(Rate Limits)](https://docs.upbit.com/kr/reference/rate-limits)
- [REST API 사용 및 에러 안내](https://docs.upbit.com/kr/reference/rest-api-guide)
- [WebSocket 사용 및 에러 안내](https://docs.upbit.com/kr/reference/websocket-guide)

## 기본 방향

- Upbit API는 `Quotation`과 `Exchange`로 나뉜다.
- `Quotation`은 시세 조회 API이며 인증 없이 사용할 수 있다.
- `Exchange`는 계정, 잔고, 주문, 입출금 API이며 API Key 기반 인증이 필수다.
- REST API는 주문 생성, 주문 취소, 계정 조회처럼 명확한 요청-응답 작업에 사용한다.
- WebSocket은 시세, 체결, 호가, 내 주문, 내 자산 변동처럼 실시간성이 필요한 데이터에 사용한다.
- 자동매매 판단에 실시간 시세가 중요해지면 REST polling보다 WebSocket 구독을 우선 검토한다.
- Tauri 앱에서는 API Key와 JWT 생성을 프론트엔드 React 코드가 아니라 Rust 백엔드에서 처리한다.

## 인증 구현

- Exchange REST API와 private WebSocket은 모두 JWT 인증이 필요하다.
- JWT 알고리즘은 `HS512`를 사용한다.
- JWT payload에는 항상 `access_key`와 매 요청마다 새로 만든 `nonce`를 넣는다.
- `nonce`는 재사용하면 안 된다. `nonce_used` 에러가 발생하면 요청 재시도 로직이 nonce를 재사용하고 있지 않은지 먼저 확인한다.
- Secret Key는 Base64 인코딩된 값이 아니다. JWT 라이브러리에 넣기 전에 Base64 decode를 수행하지 않는다.
- 인증 헤더는 `Authorization: Bearer {jwt}` 형식으로 보낸다.
- API Key는 발급 시점에 필요한 권한만 부여한다. 잔고 조회는 자산조회, 주문 가능정보/주문 조회는 주문조회, 주문 생성은 주문하기 권한이 필요하다.
- Upbit API Key에는 호출 허용 IP가 설정된다. `no_authorization_ip`가 나오면 코드보다 실행 환경 IP 등록 상태를 먼저 확인한다.

## `query_hash` 규칙

인증이 필요한 REST 요청에 쿼리 파라미터 또는 JSON 본문이 있으면 JWT payload에 `query_hash`와 `query_hash_alg: "SHA512"`를 포함해야 한다.

- `query_hash`는 실제 요청의 쿼리 문자열 또는 JSON body를 쿼리 문자열 형태로 바꾼 값을 SHA-512로 해시한 값이다.
- GET/DELETE 요청은 실제 요청 URL에 들어가는 쿼리 문자열을 기준으로 해시한다.
- 파라미터 순서를 정렬하거나 임의로 바꾸지 않는다. 실제 요청과 해시 입력 문자열의 순서가 다르면 인증 실패가 날 수 있다.
- `states[]`, `uuids[]`처럼 이름에 `[]`가 포함된 배열 파라미터는 `states[]=wait&states[]=watch`처럼 Key-Value를 반복한다.
- `pairs`, `quote_currencies`처럼 `[]`가 없고 쉼표 구분을 지원하는 파라미터는 `pairs=KRW-BTC,KRW-ETH`처럼 하나의 문자열로 만든다.
- 해시 입력은 URL 인코딩 전 문자열 기준이다.
- 다만 실제 GET/DELETE 요청 URL은 URL 인코딩되어야 한다. Exchange 배열 파라미터의 `[`와 `]`는 인코딩하지 않는다.
- POST 요청은 JSON body의 모든 Key-Value를 `key=value&key=value` 형태로 만들어 해시한다.
- POST body를 생성할 때 `HashMap`처럼 순서가 보장되지 않는 자료구조를 사용하지 않는다. 인증 해시 문자열과 실제 JSON body의 필드 구성이 어긋날 수 있다.
- Rust에서는 서명 대상 요청을 typed struct 또는 명시적인 ordered pair 목록으로 구성하고, JSON body와 `query_hash` 입력을 같은 소스에서 만들도록 한다.
- `None`, 빈 문자열, optional 필드 생략 규칙은 JSON body와 해시 문자열에서 반드시 동일해야 한다.

## REST API 사용

- REST API base endpoint는 `https://api.upbit.com/v1`이다.
- TLS 1.2 이상이 필요하다. 클라이언트 런타임은 TLS 1.3을 사용할 수 있으면 우선 사용한다.
- POST 요청은 `Content-Type: application/json; charset=utf-8`로 JSON body를 전송한다.
- POST Form 방식은 사용하지 않는다.
- Exchange API 호출에는 반드시 JWT `Authorization` 헤더를 포함한다.
- REST 응답의 `Remaining-Req` 헤더를 읽어 rate limit 상태를 추적한다.
- `Remaining-Req`의 `sec` 값이 0이면 같은 초 안에 추가 요청을 보내지 않는다.
- Quotation API 응답 압축이 필요하면 `Accept-Encoding: gzip`을 사용할 수 있다. gzip 지원은 Quotation API 기준으로만 판단한다.
- 브라우저/프론트엔드에서 Upbit REST API를 직접 호출하지 않는다. `Origin` 헤더가 포함되면 별도의 강한 제한이 적용될 수 있으므로 Tauri Rust 백엔드에서 호출한다.

## REST 에러 처리

- 에러 응답은 `error.name`, `error.message` 형태로 처리한다.
- Quotation API는 `error.name`이 숫자일 수 있고, Exchange API는 문자열 코드일 수 있다. 타입을 하나로 고정하지 않는다.
- `400 Bad Request`는 주문 파라미터, 최소 주문 금액, 잔고, 필수 파라미터 누락을 우선 확인한다.
- `401 Unauthorized`는 JWT 생성, query hash, nonce 재사용, API Key 만료, 허용 IP, 권한 범위를 확인한다.
- `404 Not Found`는 주문, 출금, 입금, 체결 등 요청 대상 UUID 또는 ID가 실제 존재하는지 확인한다.
- `429 Too Many Requests`는 요청 한도 초과다. 즉시 재시도하지 말고 rate limiter가 다음 허용 시점까지 대기해야 한다.
- `418`은 과도한 요청으로 IP 또는 계정이 일시 차단된 상태다. 응답에 포함된 차단 시간을 기준으로 재시도한다.
- `500` 계열은 서버 또는 점검 이슈로 보고 사용자에게 재시도 가능 상태로 노출하되, 주문 중복 전송을 피한다.

## 요청 수 제한

Rate limit은 API별 개별 제한이 아니라 Rate Limit 그룹별로 집계된다.

- Quotation REST API는 IP 단위로 제한된다.
- Exchange REST API는 계정 단위로 제한된다. 같은 계정에서 여러 API Key를 발급해도 한도를 공유한다.
- WebSocket은 인증 없이 시세만 구독하면 IP 단위, 인증이 포함된 private 구독은 계정 단위로 제한된다.
- Quotation `market`, `candle`, `trade`, `ticker`, `orderbook` 그룹은 각각 초당 최대 10회다.
- Exchange `default` 그룹은 초당 최대 30회다.
- Exchange `order`와 `order-test` 그룹은 각각 초당 최대 8회다.
- Exchange `order-cancel-all`은 2초당 최대 1회다.
- WebSocket 연결 요청은 초당 최대 5회다.
- WebSocket 데이터 요청 메시지는 초당 최대 5회, 분당 최대 100회다.
- Rate limit 초과 시 `429`가 반환된다.
- `429` 상태에서도 계속 요청하면 `418` 차단으로 이어질 수 있다.
- 자동매매 루프는 API 호출 전역 rate limiter를 반드시 거쳐야 한다.
- 주문 API는 별도 그룹 한도가 작으므로 시세 조회 루프와 주문 실행 루프를 분리하고, 주문 재시도에는 backoff를 적용한다.

## WebSocket 사용

- 시세 WebSocket endpoint는 `wss://api.upbit.com/websocket/v1`이다.
- 내 자산 및 내 주문 WebSocket endpoint는 `wss://api.upbit.com/websocket/v1/private`이다.
- private WebSocket은 JWT `Authorization` 헤더가 필요하다.
- 일부 WebSocket 클라이언트는 커스텀 헤더를 지원하지 않는다. Tauri에서는 React 브라우저 WebSocket보다 Rust WebSocket 클라이언트 사용을 우선한다.
- 요청 메시지는 JSON Array 형식이다.
- 첫 번째 요소는 `ticket` object여야 하며, UUID처럼 고유한 문자열을 사용한다.
- 두 번째 요소부터 `type`을 가진 데이터 요청 object를 넣는다.
- `ticker`, `trade`, `orderbook`, `candle.{unit}`에는 조회할 페어 목록인 `codes`가 필요하다.
- `myAsset`, `myOrder`는 private endpoint와 인증 헤더를 전제로 설계한다.
- 응답 크기를 줄여야 하면 `format` object로 `SIMPLE`, `JSON_LIST`, `SIMPLE_LIST`를 검토한다.
- `SIMPLE` 계열은 필드명이 축약되므로 타입 정의와 파서가 별도로 필요하다.
- WebSocket 연결은 120초 동안 송수신이 없으면 idle timeout으로 종료될 수 있다.
- 연결 유지에는 PING/PONG frame 또는 주기적 메시지 수신 상태 감시가 필요하다.
- 연결 끊김은 정상 운영 상황으로 보고 재연결 로직을 구현한다.
- 재연결은 즉시 무한 반복하지 말고 rate limit을 고려한 backoff를 적용한다.
- WebSocket 에러는 `INVALID_AUTH`, `WRONG_FORMAT`, `NO_TICKET`, `NO_TYPE`, `NO_CODES`, `INVALID_PARAM` 등을 분기 처리한다.

## Autobo 코드 작업 체크리스트

- Upbit 호출 코드는 React 컴포넌트에 직접 두지 않는다. Rust의 API client 계층으로 모은다.
- API Key는 파일, localStorage, 로그, 에러 메시지에 저장하거나 출력하지 않는다.
- 주문 생성 전에는 `order-test` API 또는 dry-run 경로를 먼저 통과시킨다.
- 실주문 기능은 UI에서 명시적으로 dry-run을 해제했을 때만 가능해야 한다.
- 실주문 버튼과 자동매매 시작은 서로 다른 안전 장치를 가진다.
- 주문 재시도는 네트워크 오류와 서버 오류만 제한적으로 수행한다. 400/401 계열은 사용자의 설정 또는 인증 문제로 처리한다.
- 주문 요청에는 idempotency 관점의 `identifier` 사용을 검토한다.
- 주문 후에는 주문 생성 응답만 믿지 말고 주문 조회 또는 WebSocket `myOrder` 이벤트로 최종 상태를 확인한다.
- REST polling 주기는 rate limit보다 충분히 낮게 잡고, 실시간 전략에는 WebSocket을 사용한다.
- 모든 Upbit 응답은 원문 JSON을 보존할 수 있게 로그/디버그 경로를 만들되 민감정보는 마스킹한다.
- API 문서가 변경될 수 있으므로 주요 엔드포인트 구현 전 해당 Reference 하단의 Rate Limit, Permission, 파라미터 설명을 다시 확인한다.
