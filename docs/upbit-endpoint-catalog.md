# Upbit API 엔드포인트 구현 메모

확인일: 2026-05-11

이 문서는 Autobo에서 우선 구현 대상으로 검토하는 Upbit REST API 엔드포인트를 기능별로 정리한다. 전역 인증, `query_hash`, rate limit, REST/WebSocket 공통 주의사항은 [upbit-api-implementation-notes.md](./upbit-api-implementation-notes.md)를 먼저 따른다.

## 구현 원칙

- `Quotation` API는 인증 없이 호출하지만 IP 단위 rate limit을 공유한다.
- `Exchange` API는 JWT 인증이 필요하며 계정 단위 rate limit을 공유한다.
- `Exchange`의 GET/DELETE 쿼리 파라미터는 JWT `query_hash` 입력과 실제 URL이 같은 순서/구성을 갖도록 ordered pair로 만든다.
- POST 요청은 JSON body만 사용한다. Form 또는 urlencoded body를 쓰지 않는다.
- DELETE 중 일부 주문 취소 API는 request body를 지원하지 않는다. 반드시 query parameter로 보낸다.
- 주문 생성, 주문 테스트, 취소 후 재주문은 같은 주문 생성 계열 검증 로직을 공유한다.
- 주문 조회/취소에서 `uuid`와 `identifier`를 동시에 허용하는 API는 `uuid`가 우선한다.
- `uuid[]`와 `identifier[]`처럼 배열 식별자 API는 두 종류를 동시에 보내지 않는다.
- 출금 API는 주문 API보다 더 강한 UI 확인 절차와 권한 분리를 둔다. 자동매매 전략 코드에서 출금 요청 API를 직접 호출하지 않는다.
- 입금 API 중 원화 입금과 주소 생성은 사용자의 명시적 요청이 있는 관리 기능으로만 제공한다. 자동매매 전략 코드에서 입금 요청 API를 직접 호출하지 않는다.

## Quotation API

### 페어 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-trading-pairs>
- Method/Path: `GET /v1/market/all`
- 인증: 없음
- Rate limit: `market` 그룹, 초당 최대 10회, IP 단위
- Query: `is_details?: boolean`
- 구현 메모:
  - 앱 시작 시 마켓 목록 캐시를 만들 때 사용한다.
  - `is_details=true` 응답에는 시장 경보/이벤트성 필드가 포함될 수 있으므로 타입을 확장 가능하게 둔다.
  - 주문 가능 여부 판단은 이 API만으로 하지 말고 Exchange의 주문 가능정보 API를 함께 사용한다.

### 캔들 조회

- 문서:
  - <https://docs.upbit.com/kr/reference/list-candles-seconds>
  - <https://docs.upbit.com/kr/reference/list-candles-minutes>
  - <https://docs.upbit.com/kr/reference/list-candles-days>
  - <https://docs.upbit.com/kr/reference/list-candles-weeks>
  - <https://docs.upbit.com/kr/reference/list-candles-months>
  - <https://docs.upbit.com/kr/reference/list-candles-years>
- 인증: 없음
- Rate limit: `candle` 그룹, 초당 최대 10회, IP 단위
- 공통 Query: `market: string`, `to?: string`, `count?: number`
- 구현 메모:
  - 캔들은 해당 시간 구간에 체결이 있을 때만 생성된다. 응답 배열에 빈 시간 구간이 빠질 수 있음을 전제로 차트/전략을 구현한다.
  - `to` 기반 pagination을 만들 때 누락 캔들을 0거래 캔들로 임의 생성하지 않는다.
  - `count` 기본값은 1이다. UI 기본 조회 개수는 명시적으로 지정한다.
  - 모든 캔들 API가 `candle` rate limit 그룹을 공유하므로 여러 주기를 동시에 갱신하지 않는다.

#### 초 캔들

- Method/Path: `GET /v1/candles/seconds`
- 추가 제약:
  - 조회 지원 기간은 요청 시점 기준 최근 3개월이다.
  - 기간 초과 시 빈 배열 또는 요청 개수보다 적은 응답이 올 수 있다.

#### 분 캔들

- Method/Path: `GET /v1/candles/minutes/{unit}`
- Path: `unit: 1 | 3 | 5 | 10 | 15 | 30 | 60 | 240`
- 구현 메모:
  - `unit`은 타입으로 제한한다. 임의 숫자를 URL에 넣지 않는다.

#### 일 캔들

- Method/Path: `GET /v1/candles/days`
- 추가 Query: `converting_price_unit?: string`
- 구현 메모:
  - `converting_price_unit=KRW`는 원화 마켓이 아닌 마켓의 종가 환산값을 받고 싶을 때만 사용한다.
  - 현재 원화 환산만 지원한다는 전제로 UI 옵션을 제한한다.

#### 주/월/연 캔들

- Method/Path:
  - `GET /v1/candles/weeks`
  - `GET /v1/candles/months`
  - `GET /v1/candles/years`
- 구현 메모:
  - 공통 캔들 타입을 재사용하되 API별 path만 분리한다.

### 페어 체결 이력 조회

- 문서: <https://docs.upbit.com/kr/reference/list-pair-trades>
- Method/Path: `GET /v1/trades/ticks`
- 인증: 없음
- Rate limit: `trade` 그룹, 초당 최대 10회, IP 단위
- Query: `market: string`, `to?: string`, `count?: number`, `cursor?: string`, `days_ago?: number`
- 구현 메모:
  - 최근 체결 목록 조회용 REST API다. 실시간 전략 입력은 WebSocket `trade` 구독을 우선한다.
  - Autobo의 실시간 체결량 화면은 KRW 마켓만 `trade` WebSocket으로 구독하고, `trade_volume`과 `trade_price * trade_volume`을 마켓별로 누적한다.
  - `cursor`와 `days_ago`를 함께 쓰는 페이지네이션은 별도 테스트가 필요하다.

### 현재가 조회

#### 페어 단위 현재가

- 문서: <https://docs.upbit.com/kr/reference/list-tickers>
- Method/Path: `GET /v1/ticker`
- 인증: 없음
- Rate limit: `ticker` 그룹, 초당 최대 10회, IP 단위
- Query: `markets: string`
- 구현 메모:
  - `markets`는 쉼표 구분 문자열이다.
  - `change`, `change_price`, `change_rate`, `signed_change_price`, `signed_change_rate`는 전일 종가 기준 지표다.
  - 단일 마켓 polling은 간단하지만, 자동매매 감시 마켓이 늘어나면 WebSocket `ticker`로 전환한다.

#### 마켓 단위 현재가

- 문서: <https://docs.upbit.com/kr/reference/list-quote-tickers>
- Method/Path: `GET /v1/ticker/all`
- 인증: 없음
- Rate limit: `ticker` 그룹, 초당 최대 10회, IP 단위
- Query: `quote_currencies: string`
- 구현 메모:
  - Autobo 화면에서는 KRW 마켓만 사용하므로 `quote_currencies=KRW`로 고정한다.
  - 여러 마켓 전체 스캔에는 유용하지만, 응답 크기와 갱신 주기를 rate limit에 맞춘다.

### 호가 조회

#### 호가 정보

- 문서: <https://docs.upbit.com/kr/reference/list-orderbooks>
- Method/Path: `GET /v1/orderbook`
- 인증: 없음
- Rate limit: `orderbook` 그룹, 초당 최대 10회, IP 단위
- Query: `markets: string`, `level?: string`, `count?: number`
- 구현 메모:
  - `markets`는 쉼표 구분 문자열이다.
  - `level` 기본값은 `0`이며, 원화 마켓에서 호가 모아보기에 사용한다.
  - `count` 기본값은 30이다.
  - 미지원 `level`을 보내면 빈 배열이 올 수 있으므로, 호가 정책 조회 API로 지원 단위를 먼저 확인한다.

#### 호가 정책

- 문서: <https://docs.upbit.com/kr/reference/list-orderbook-instruments>
- Method/Path: `GET /v1/orderbook/instruments`
- 인증: 없음
- Rate limit: `orderbook` 그룹, 초당 최대 10회, IP 단위
- Query: `markets: string`
- 구현 메모:
  - 주문 가격 단위, 호가 모아보기 단위 검증에 사용한다.
  - 주문 UI의 가격 입력 step과 서버 검증 전 사전 검증에 활용한다.

## Exchange API

### 계정 잔고 조회

- 문서: <https://docs.upbit.com/kr/reference/get-balance>
- Method/Path: `GET /v1/accounts`
- 인증: 필요
- 권한: `자산조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- 구현 메모:
  - API Key 권한 오류와 허용 IP 오류를 사용자에게 구분해서 보여준다.
  - 주문 생성 후 locked 자산 확인에 사용한다.

### 주문 가능 정보 조회

- 문서: <https://docs.upbit.com/kr/reference/available-order-information>
- Method/Path: `GET /v1/orders/chance`
- 인증: 필요
- 권한: `주문조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query: `market: string`
- 구현 메모:
  - 주문 전 수수료율, 지원 주문 방향, 지원 주문 유형, 최소/최대 주문 금액, 계정 잔고를 확인한다.
  - `market.order_types`는 deprecated 예정이므로 `market.ask_types`, `market.bid_types`를 사용한다.

### 주문 생성

- 문서: <https://docs.upbit.com/kr/reference/new-order>
- Method/Path: `POST /v1/orders`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `order` 그룹, 초당 최대 8회, 계정 단위
- Body:
  - `market: string`
  - `side: "bid" | "ask"`
  - `volume?: string`
  - `price?: string`
  - `ord_type: "limit" | "price" | "market" | "best"`
  - `identifier?: string`
  - `time_in_force?: "ioc" | "fok" | "post_only"`
  - `smp_type?: "cancel_maker" | "cancel_taker" | "reduce"`
- 구현 메모:
  - 성공 상태 코드는 `201 Created`다.
  - 지정가 매수/매도: `ord_type=limit`, `volume`과 `price`가 모두 필요하다.
  - 시장가 매수: `side=bid`, `ord_type=price`, `price`만 필요하며 `volume`은 보내지 않는다.
  - 시장가 매도: `side=ask`, `ord_type=market`, `volume`만 필요하며 `price`는 보내지 않는다.
  - 최유리 지정가 매수: `side=bid`, `ord_type=best`, `price`와 `time_in_force`가 필요하며 `volume`은 보내지 않는다.
  - 최유리 지정가 매도: `side=ask`, `ord_type=best`, `volume`과 `time_in_force`가 필요하며 `price`는 보내지 않는다.
  - `time_in_force=post_only`는 `ord_type=limit`에서만 사용하고, `smp_type`과 같이 보내지 않는다.
  - `identifier`는 계정 전체 기준으로 고유해야 하며, 재사용할 수 없고 최대 32자다.
  - 주문 생성 시 자산이 locked 상태가 될 수 있으므로 주문 후 잔고/주문 상태를 재조회한다.
  - 실주문 전에는 주문 생성 테스트 또는 앱 내부 dry-run을 반드시 거친다.

### 주문 생성 테스트

- 문서: <https://docs.upbit.com/kr/reference/test-order>
- Method/Path: `POST /v1/orders/test`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `order-test` 그룹, 초당 최대 8회, 계정 단위
- Body: 주문 생성과 동일한 필드
- 구현 메모:
  - 실제 주문을 만들지 않고 주문 요청 형식과 주문 가능 상태를 검증한다.
  - 정상 응답은 요청 형식과 해당 페어 주문 가능 상태가 유효함을 의미한다.
  - 반환된 UUID 또는 identifier는 실제 주문 조회/취소에 사용할 수 없다.
  - `market_offline` 오류는 해당 페어 주문이 불가능한 상태로 처리한다.

### 주문 조회

#### 개별 주문 조회

- 문서: <https://docs.upbit.com/kr/reference/get-order>
- Method/Path: `GET /v1/order`
- 인증: 필요
- 권한: `주문조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query: `uuid?: string`, `identifier?: string`
- 구현 메모:
  - `uuid` 또는 `identifier` 중 하나는 반드시 포함한다.
  - 둘 다 보내면 `uuid` 기준으로 조회된다.

#### id로 주문 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-orders-by-ids>
- Method/Path: `GET /v1/orders/uuids`
- 인증: 필요
- 권한: `주문조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query: `market?: string`, `uuids[]?: string[]`, `identifiers[]?: string[]`, `order_by?: "asc" | "desc"`
- 구현 메모:
  - `uuids[]` 또는 `identifiers[]` 중 하나는 반드시 포함한다.
  - `uuids[]`와 `identifiers[]`는 동시에 사용할 수 없다.
  - 배열 쿼리는 `uuids[]=...&uuids[]=...` 형식으로 만들고 `query_hash`에도 같은 문자열을 사용한다.

#### 체결 대기 주문 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-open-orders>
- Method/Path: `GET /v1/orders/open`
- 인증: 필요
- 권한: `주문조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `market?: string`
  - `state?: "wait" | "watch"`
  - `states[]?: string[]`
  - `page?: number`
  - `limit?: number`
  - `order_by?: "asc" | "desc"`
- 구현 메모:
  - `state`와 `states[]`는 동시에 사용할 수 없다.
  - 기본 상태는 체결 대기 계열이다.
  - 자동매매에서는 주문 생성 후 미체결 상태 추적에 사용한다.

#### 종료 주문 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-closed-orders>
- Method/Path: `GET /v1/orders/closed`
- 인증: 필요
- 권한: `주문조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `market?: string`
  - `state?: "done,cancel" | "done" | "cancel"`
  - `states[]?: string[]`
  - `start_time?: string`
  - `end_time?: string`
  - `limit?: number`
  - `order_by?: "asc" | "desc"`
- 구현 메모:
  - 종료 주문은 전량 체결 주문과 취소 주문을 포함한다.
  - 조회 기간을 지정하는 경우 최대 7일 구간을 조회한다.
  - `state`와 `states[]`는 동시에 사용할 수 없다.

### 주문 취소

#### 개별 주문 취소 접수

- 문서: <https://docs.upbit.com/kr/reference/cancel-order>
- Method/Path: `DELETE /v1/order`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query: `uuid?: string`, `identifier?: string`
- 구현 메모:
  - `uuid` 또는 `identifier` 중 하나는 반드시 포함한다.
  - 둘 다 보내면 `uuid` 기준으로 취소된다.
  - DELETE request body를 보내지 않는다.

#### id로 주문 목록 취소 접수

- 문서: <https://docs.upbit.com/kr/reference/cancel-orders-by-ids>
- Method/Path: `DELETE /v1/orders/uuids`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query: `uuids[]?: string[]`, `identifiers[]?: string[]`
- 구현 메모:
  - request body를 지원하지 않는다. 모든 파라미터는 query parameter로 보낸다.
  - `uuids[]` 또는 `identifiers[]` 중 하나는 반드시 포함한다.
  - 두 파라미터는 동시에 사용할 수 없다.
  - 이미 체결 완료, 이미 취소 완료, 페어 서비스 정지 상태에서는 취소가 거절될 수 있다.

#### 주문 일괄 취소 접수

- 문서: <https://docs.upbit.com/kr/reference/batch-cancel-orders>
- Method/Path: `DELETE /v1/orders/open`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `order-cancel-all` 그룹, 2초당 최대 1회
- Query:
  - `quote_currencies?: string`
  - `cancel_side?: "bid" | "ask" | "all"`
  - `count?: number`
  - `order_by?: "asc" | "desc"`
  - `pairs?: string`
  - `exclude_pairs?: string`
- 구현 메모:
  - 오직 `WAIT` 상태 주문만 일괄 취소할 수 있다.
  - `WATCH` 상태 주문은 개별 취소 또는 id 목록 취소를 사용한다.
  - request body를 지원하지 않는다. 모든 파라미터는 query parameter로 보낸다.
  - `pairs`와 `quote_currencies`는 동시에 사용할 수 없다.
  - 취소 제외 페어는 취소 대상보다 높은 우선순위로 적용된다.
  - 취소 처리 중 체결이 발생할 수 있으므로 취소 응답 이후 주문 상태를 다시 조회한다.

### 취소 후 재주문

- 문서: <https://docs.upbit.com/kr/reference/cancel-and-new-order>
- Method/Path: `POST /v1/orders/cancel_and_new`
- 인증: 필요
- 권한: `주문하기`
- Rate limit: `order` 그룹, 초당 최대 8회, 계정 단위
- Body:
  - `prev_order_uuid?: string`
  - `prev_order_identifier?: string`
  - `new_ord_type: "limit" | "price" | "market" | "best"`
  - `new_volume?: string`
  - `new_price?: string`
  - `new_identifier?: string`
  - `new_time_in_force?: "ioc" | "fok" | "post_only"`
  - `new_smp_type?: "reduce" | "cancel_maker" | "cancel_taker"`
- 구현 메모:
  - 기존 주문과 동일한 페어, 동일한 주문 방향으로만 신규 주문을 만들 수 있다.
  - `prev_order_uuid` 또는 `prev_order_identifier` 중 하나는 반드시 포함한다.
  - 기존 주문의 취소가 완료된 후 신규 주문이 생성된다.
  - API 요청이 성공적으로 접수되어도, 기존 주문이 취소 전에 전량 체결되면 신규 주문은 생성되지 않을 수 있다.
  - 기존 주문에 사용한 identifier는 `new_identifier`로 재사용할 수 없다.
  - 부분 체결 주문은 `new_volume="remain_only"`로 기존 주문 잔량을 신규 주문 수량으로 지정할 수 있다.
  - 신규 지정가: `new_volume`, `new_price` 필요.
  - 신규 시장가 매수: `new_price` 필요.
  - 신규 시장가 매도: `new_volume` 필요.
  - 신규 최유리 지정가 매수: `new_price`, `new_time_in_force` 필요.
  - 신규 최유리 지정가 매도: `new_volume`, `new_time_in_force` 필요.

### 출금

출금 API는 실수나 악성 자동화의 피해가 크다. Autobo에서는 기본적으로 조회 API만 우선 구현하고, 실제 출금 요청은 별도 기능 플래그와 다중 확인 UI가 있을 때만 연결한다.

#### 출금 가능 정보 조회

- 문서: <https://docs.upbit.com/kr/reference/available-withdrawal-information>
- Method/Path: `GET /v1/withdraws/chance`
- 인증: 필요
- 권한: `출금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency: string`
  - `net_type?: string`
- 구현 메모:
  - 출금 수수료, 지갑 상태, 출금 지원 여부, 잔고, 1회/일일/잔여 한도, 인증 상태를 확인한다.
  - 디지털 자산은 `net_type`에 따라 출금 가능 여부와 정책이 달라질 수 있다.
  - 실제 출금 요청 전에는 이 API와 출금 허용 주소 목록을 모두 확인한다.
  - `withdraw_limit.can_withdraw`가 false이면 UI에서 출금 요청 버튼을 비활성화한다.

#### 출금 허용 주소 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-withdrawal-addresses>
- Method/Path: `GET /v1/withdraws/coin_addresses`
- 인증: 필요
- 권한: `출금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- 구현 메모:
  - API를 통한 디지털 자산 출금은 사전에 Upbit 웹에서 등록된 출금 허용 주소로만 요청한다.
  - API로 출금 허용 주소를 등록할 수 없다.
  - 디지털 자산 출금 요청의 `net_type`은 이 응답에서 받은 값을 사용한다.
  - `network_name`은 UI 표시용 이름이며 API 요청 식별자로 사용하지 않는다.
  - 트래블룰 검증 결과에 따라 출금이 제한될 수 있으므로, 주소가 목록에 있어도 최종 출금 가능 여부는 출금 가능 정보와 요청 응답으로 판단한다.
  - 개인 지갑/거래소 지갑/개인 소유/법인 소유 여부에 따라 `exchange_name`, `wallet_type`, `beneficiary_type`, `beneficiary_name`, `beneficiary_company_name` 일부가 null일 수 있다.

#### 디지털 자산 출금 요청

- 문서: <https://docs.upbit.com/kr/reference/withdraw>
- Method/Path: `POST /v1/withdraws/coin`
- 인증: 필요
- 권한: `출금하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Body:
  - `currency: string`
  - `net_type: string`
  - `amount: string`
  - `address: string`
  - `secondary_address?: string | null`
  - `transaction_type?: "default" | "internal"`
- 구현 메모:
  - 성공 상태 코드는 `201 Created`다.
  - POST Form 방식은 사용하지 않고 JSON body만 사용한다.
  - 출금 대상 주소는 반드시 사전에 등록된 출금 허용 주소여야 한다.
  - `net_type`은 필수이며, 출금 허용 주소 목록 조회 응답의 네트워크 타입 값을 그대로 사용한다.
  - `secondary_address`는 destination tag, memo 등 보조 주소가 필요한 네트워크에서만 사용한다.
  - `transaction_type=default`는 일반 블록체인 출금이다.
  - `transaction_type=internal`은 Upbit 계정 간 바로 출금이며, Upbit 회원 주소가 아닌 곳으로 요청하면 정상 수행되지 않을 수 있다.
  - UI에는 주소, 네트워크, 보조 주소, 수량, 예상 수수료, 남은 한도를 한 화면에서 재확인시키고 최종 확인 절차를 둔다.
  - 자동매매 전략, 리밸런싱, 주문 후 정산 로직에서 이 API를 직접 호출하지 않는다.

#### 원화 출금 요청

- 문서: <https://docs.upbit.com/kr/reference/withdraw-krw>
- Method/Path: `POST /v1/withdraws/krw`
- 인증: 필요
- 권한: `출금하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Body:
  - `amount: string`
  - `two_factor_type: "kakao" | "naver" | "hana"`
- 구현 메모:
  - 성공 상태 코드는 `201 Created`다.
  - POST Form 방식은 사용하지 않고 JSON body만 사용한다.
  - 원화 출금은 2채널 인증 수단을 통한 사용자 인증 완료 후 실행된다.
  - 지원 인증 수단은 `kakao`, `naver`, `hana`다.
  - 원화 출금은 자동화 대상으로 두지 않는다. 사용자가 명시적으로 금액과 인증 수단을 선택한 경우에만 요청한다.

#### 개별 출금 조회

- 문서: <https://docs.upbit.com/kr/reference/get-withdrawal>
- Method/Path: `GET /v1/withdraw`
- 인증: 필요
- 권한: `출금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `uuid?: string`
  - `txid?: string`
  - `currency?: string`
- 구현 메모:
  - 출금 UUID 또는 TXID 기반으로 개별 출금 상태를 조회한다.
  - TXID만으로 조회할 때 통화 구분이 필요한 상황이 있을 수 있으므로 `currency`를 함께 받는 요청 모델을 제공한다.
  - 존재하지 않는 출금은 `404`로 처리한다.
  - 출금 요청 직후에는 상태가 즉시 최종 상태가 아닐 수 있으므로 polling 간격을 둔다.

#### 출금 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-withdrawals>
- Method/Path: `GET /v1/withdraws`
- 인증: 필요
- 권한: `출금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency?: string`
  - `state?: string`
  - `uuids[]?: string[]`
  - `txids[]?: string[]`
  - `limit?: number`
  - `page?: number`
  - `order_by?: "asc" | "desc"`
  - `from?: string`
  - `to?: string`
- 구현 메모:
  - 조건을 지정하지 않으면 최근 100개 출금 이력이 반환된다.
  - `limit` 기본값은 100, `page` 기본값은 1, `order_by` 기본값은 `desc`다.
  - 배열 쿼리는 `uuids[]=...&uuids[]=...` 또는 `txids[]=...&txids[]=...` 형식으로 만들고, `query_hash`에도 같은 문자열을 사용한다.
  - `from`/`to` 기간 필터와 페이지네이션 조합은 UI에서 명확히 표시한다.
  - 출금 상태 필터는 서버 enum 변경 가능성을 고려해 string union을 너무 좁게 고정하지 않는다.

#### 디지털 자산 출금 취소 요청

- 문서: <https://docs.upbit.com/kr/reference/cancel-withdrawal>
- Method/Path: `DELETE /v1/withdraws/coin`
- 인증: 필요
- 권한: `출금하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `uuid: string`
- 구현 메모:
  - 디지털 자산 출금 중 취소 가능한 상태의 출금건만 취소 접수가 가능하다.
  - request body를 보내지 않는다. `uuid`는 query parameter로 보낸다.
  - 응답의 `is_cancelable` 필드로 취소 접수 가능 여부를 확인한다.
  - 취소 가능 여부는 통화 정책과 네트워크 지연 상태에 따라 실시간으로 바뀔 수 있다.
  - 취소 요청 후에는 개별 출금 조회로 최종 상태를 다시 확인한다.

### 입금

입금 API는 주소 관리, 원화 입금 요청, 입금 상태 조회로 나뉜다. 디지털 자산 입금은 외부 체인/거래소 상태와 트래블룰 영향을 받을 수 있으므로, API 응답만으로 실제 입금 가능 상태를 단정하지 않는다.

#### 디지털 자산 입금 가능 정보 조회

- 문서: <https://docs.upbit.com/kr/reference/available-deposit-information>
- Method/Path: `GET /v1/deposits/chance/coin`
- 인증: 필요
- 권한: `입금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency: string`
  - `net_type: string`
- 구현 메모:
  - 입금 가능 여부, 입금 불가 사유, 최소 입금 수량, 필요 confirmation 수, 소수점 정밀도 정책을 확인한다.
  - 이 API는 실시간 상태 조회를 보장하지 않는다. 실제 입금 전에는 Upbit 공지사항과 실시간 입출금 현황도 확인해야 한다.
  - 자동매매 전략 판단에 이 응답을 직접 사용하지 않는다. 입금 가능 여부는 사용자 안내와 관리 UI의 참고 정보로만 사용한다.
  - `currency`와 `net_type`은 둘 다 필수다.

#### 입금 주소 생성 요청

- 문서: <https://docs.upbit.com/kr/reference/create-deposit-address>
- Method/Path: `POST /v1/deposits/generate_coin_address`
- 인증: 필요
- 권한: `입금하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Body:
  - `currency: string`
  - `net_type: string`
- 구현 메모:
  - POST Form 방식은 사용하지 않고 JSON body만 사용한다.
  - 입금 주소 생성은 비동기 방식으로 동작한다.
  - 최초 요청 직후에는 `success`, `message`만 포함된 접수 응답이 올 수 있다.
  - 주소 생성이 완료된 이후에는 `currency`, `net_type`, `deposit_address`를 포함한 주소 정보가 반환된다.
  - 일정 시간이 지나도 주소가 생성되지 않으면 간격을 두고 다시 호출한다.
  - 같은 통화/네트워크의 주소는 최초 1회 생성되며, 이후 생성 요청은 기존 생성 주소를 반환할 수 있다.
  - UI에서는 주소 생성 요청과 실제 주소 확인을 분리해서 보여준다. 생성 요청 성공을 입금 주소 확보로 표시하지 않는다.

#### 개별 입금 주소 조회

- 문서: <https://docs.upbit.com/kr/reference/get-deposit-address>
- Method/Path: `GET /v1/deposits/coin_address`
- 인증: 필요
- 권한: `입금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency: string`
  - `net_type: string`
- 구현 메모:
  - 입금 주소 생성 직후 주소 생성이 완료되기 전에는 `deposit_address`가 null일 수 있다.
  - `deposit_address`가 null이면 오류로 단정하지 말고 일정 시간 후 재조회한다.
  - 주소 표시 UI는 `currency`, `net_type`, `deposit_address`, 보조 주소 필드가 있는 경우 이를 함께 표시한다.
  - 주소 복사 기능을 만들 때 네트워크 타입을 같이 노출해 오입금을 줄인다.

#### 입금 주소 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-deposit-addresses>
- Method/Path: `GET /v1/deposits/coin_addresses`
- 인증: 필요
- 권한: `입금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- 구현 메모:
  - 계정에 생성된 디지털 자산 입금 주소 목록 조회에 사용한다.
  - 주소가 없는 통화/네트워크는 개별 주소 생성 요청 또는 개별 주소 조회 흐름에서 처리한다.
  - 주소 목록 캐시는 사용 가능하지만, 사용자가 입금 주소를 새로 생성한 직후에는 강제 갱신한다.

#### 원화 입금

- 문서: <https://docs.upbit.com/kr/reference/deposit-krw>
- Method/Path: `POST /v1/deposits/krw`
- 인증: 필요
- 권한: `입금하기`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Body:
  - `amount: string`
  - `two_factor_type: "kakao" | "naver" | "hana"`
- 구현 메모:
  - 성공 상태 코드는 `201 Created`다.
  - POST Form 방식은 사용하지 않고 JSON body만 사용한다.
  - 2채널 인증 수단은 `kakao`, `naver`, `hana` 중 하나다.
  - 원화 입금은 사용자의 명시적 조작과 2채널 인증이 필요한 관리 기능으로 취급한다.
  - 자동매매 전략, 잔고 부족 보충, 리밸런싱 로직에서 이 API를 직접 호출하지 않는다.

#### 개별 입금 조회

- 문서: <https://docs.upbit.com/kr/reference/get-deposit>
- Method/Path: `GET /v1/deposit`
- 인증: 필요
- 권한: `입금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency?: string`
  - `uuid?: string`
  - `txid?: string`
- 구현 메모:
  - 입금 UUID 또는 TXID 기반으로 개별 입금 상태를 조회한다.
  - TXID 기반 조회에서는 통화 구분이 필요한 상황이 있을 수 있으므로 `currency`를 함께 받을 수 있게 한다.
  - 존재하지 않는 입금은 `404`로 처리한다.
  - 입금은 외부 네트워크 confirmation과 내부 심사 상태에 따라 최종 반영까지 시간이 걸릴 수 있으므로 polling 간격을 둔다.

#### 입금 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-deposits>
- Method/Path: `GET /v1/deposits`
- 인증: 필요
- 권한: `입금조회`
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- Query:
  - `currency?: string`
  - `state?: "PROCESSING" | "ACCEPTED" | "CANCELLED" | "REJECTED" | "TRAVEL_RULE_SUSPECTED" | "REFUNDING" | "REFUNDED"`
  - `uuids[]?: string[]`
  - `txids[]?: string[]`
  - `limit?: number`
  - `page?: number`
  - `order_by?: "asc" | "desc"`
  - `from?: string`
  - `to?: string`
- 구현 메모:
  - 조건을 지정하지 않으면 최근 100개 입금 이력 조회 용도로 사용한다.
  - `limit` 기본값은 100, `page` 기본값은 1, `order_by` 기본값은 `desc`다.
  - 배열 쿼리는 `uuids[]=...&uuids[]=...` 또는 `txids[]=...&txids[]=...` 형식으로 만들고, `query_hash`에도 같은 문자열을 사용한다.
  - 입금 상태 enum은 문서 기준 값을 UI 필터에 사용하되, 서버 변경에 대비해 알 수 없는 문자열도 표시 가능하게 둔다.
  - `TRAVEL_RULE_SUSPECTED`, `REFUNDING`, `REFUNDED` 상태는 사용자가 조치해야 할 수 있으므로 일반 완료/진행 상태와 구분해서 표시한다.

### 서비스 정보

서비스 정보 API는 앱 시작 시 사전 점검, 진단 화면, 사용자 지원용으로 사용한다. 자동매매 전략의 실시간 의사결정 근거로 직접 사용하지 않는다.

#### 입출금 서비스 상태 조회

- 문서: <https://docs.upbit.com/kr/reference/get-service-status>
- Method/Path: `GET /v1/status/wallet`
- 인증: 필요
- 권한: 별도 권한 없음
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- 구현 메모:
  - 디지털 자산별 입출금 서비스 상태 조회에 사용한다.
  - 이 API는 실시간 상태 조회를 보장하지 않는다. 반환 상태는 수 분 정도 지연될 수 있다.
  - 실제 입출금 전에는 Upbit 공지사항과 실시간 입출금 현황 페이지도 확인해야 한다.
  - `net_type`은 API 요청 식별자에 사용하는 네트워크 타입이다.
  - `network_name`은 UI 표시용 이름이며 API 요청 식별자로 사용하지 않는다.
  - 입금/출금 관리 UI에서 경고 배지와 사전 점검 정보로 표시하되, 최종 가능 여부는 각 입출금 가능 정보 API와 실제 요청 응답으로 판단한다.

#### API Key 목록 조회

- 문서: <https://docs.upbit.com/kr/reference/list-api-keys>
- Method/Path: `GET /v1/api_keys`
- 인증: 필요
- 권한: 별도 권한 없음
- Rate limit: `default` 그룹, 초당 최대 30회, 계정 단위
- 구현 메모:
  - 현재 입력한 API Key가 인증 가능한지, 어떤 API Key들이 계정에 등록되어 있는지 진단하는 용도로 사용한다.
  - 별도 권한은 필요 없지만 JWT 인증은 필요하다.
  - 응답에 API Key 식별 정보, 권한, 만료일, 허용 IP 등 운영상 민감한 정보가 포함될 수 있으므로 로그에 원문을 남기지 않는다.
  - UI 표시 시 access key 전체를 노출하지 말고 앞/뒤 일부만 마스킹한다.
  - 앱 시작 자동 호출보다 사용자가 진단 화면에서 명시적으로 누르는 흐름을 우선한다.
  - `out_of_scope`가 아닌 인증 실패는 키 오입력, 만료, 허용 IP, nonce/query hash 구현 문제를 구분해서 안내한다.

## 구현 우선순위 제안

1. Quotation: `market/all`, `ticker`, `orderbook`, `orderbook/instruments`
2. Exchange 조회: `accounts`, `orders/chance`
3. 주문 안전 경로: `orders/test`, 내부 dry-run, 주문 요청 validator
4. 실주문: `orders`, `order`, `orders/open`, `orders/closed`
5. 주문 취소: `DELETE /order`, `DELETE /orders/uuids`
6. 고급 주문 관리: `orders/cancel_and_new`, `DELETE /orders/open`
7. 출금 조회: `withdraws/chance`, `withdraws/coin_addresses`, `withdraw`, `withdraws`
8. 출금 실행: 별도 기능 플래그 하에서 `withdraws/coin`, `withdraws/krw`, `DELETE /withdraws/coin`
9. 입금 조회: `deposits/chance/coin`, `deposits/coin_address`, `deposits/coin_addresses`, `deposit`, `deposits`
10. 입금 실행/주소 생성: 별도 관리 UI 하에서 `deposits/generate_coin_address`, `deposits/krw`
11. 서비스 진단: `status/wallet`, `api_keys`
12. 차트/전략 보조: candles, trades

## 코드 구조 메모

- `src-tauri/src`에는 Upbit REST client를 별도 모듈로 분리한다.
- endpoint별 path, rate group, permission, auth requirement를 정적 메타데이터로 관리한다.
- 주문 body는 하나의 enum 또는 builder로 모델링하여 잘못된 조합을 타입/검증 단계에서 차단한다.
- ordered query builder를 공통화하여 URL query와 JWT `query_hash` 입력을 동시에 만든다.
- rate limiter는 endpoint path가 아니라 문서상의 rate group 기준으로 동작해야 한다.
- UI는 API 원문 enum을 그대로 노출하기보다 매수/매도/주문유형별 유효 필드만 보여준다.
- 출금 요청 API는 주문/전략 모듈에서 참조하지 못하도록 별도 서비스와 UI 경계로 분리한다.
- 입금 주소 생성과 원화 입금 API도 주문/전략 모듈에서 참조하지 못하도록 별도 서비스와 UI 경계로 분리한다.
- API Key 목록 조회 응답은 민감 운영 정보로 취급하고, 로그와 디버그 출력에는 마스킹된 형태만 남긴다.
