use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha512};
use std::sync::Mutex;
use uuid::Uuid;

const UPBIT_BASE_URL: &str = "https://api.upbit.com";
type SessionApiKeys = Mutex<Option<ApiKeys>>;

#[derive(Debug, Serialize, Deserialize)]
struct JwtClaims {
    access_key: String,
    nonce: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_hash_alg: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiKeys {
    access_key: String,
    secret_key: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct OrderRequest {
    market: String,
    side: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    volume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    price: Option<String>,
    ord_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time_in_force: Option<String>,
}

fn query_hash(query_string: &str) -> String {
    let mut hasher = Sha512::new();
    hasher.update(query_string.as_bytes());
    hex::encode(hasher.finalize())
}

fn create_jwt(keys: &ApiKeys, query_string: Option<&str>) -> Result<String, String> {
    if keys.access_key.trim().is_empty() || keys.secret_key.trim().is_empty() {
        return Err("Access Key와 Secret Key를 입력하세요.".to_string());
    }

    let mut claims = JwtClaims {
        access_key: keys.access_key.clone(),
        nonce: Uuid::new_v4().to_string(),
        query_hash: None,
        query_hash_alg: None,
    };

    if let Some(query) = query_string.filter(|query| !query.is_empty()) {
        claims.query_hash = Some(query_hash(query));
        claims.query_hash_alg = Some("SHA512".to_string());
    }

    let mut header = Header::new(Algorithm::HS512);
    header.typ = Some("JWT".to_string());

    encode(
        &header,
        &claims,
        &EncodingKey::from_secret(keys.secret_key.as_bytes()),
    )
    .map_err(|error| format!("JWT 생성 실패: {error}"))
}

fn auth_header(keys: &ApiKeys, query_string: Option<&str>) -> Result<String, String> {
    create_jwt(keys, query_string).map(|token| format!("Bearer {token}"))
}

fn order_query_string(order: &OrderRequest) -> String {
    let mut pairs = vec![
        format!("market={}", order.market),
        format!("side={}", order.side),
    ];

    if let Some(volume) = &order.volume {
        if !volume.trim().is_empty() {
            pairs.push(format!("volume={volume}"));
        }
    }

    if let Some(price) = &order.price {
        if !price.trim().is_empty() {
            pairs.push(format!("price={price}"));
        }
    }

    pairs.push(format!("ord_type={}", order.ord_type));

    if let Some(identifier) = &order.identifier {
        if !identifier.trim().is_empty() {
            pairs.push(format!("identifier={identifier}"));
        }
    }

    if let Some(time_in_force) = &order.time_in_force {
        if !time_in_force.trim().is_empty() {
            pairs.push(format!("time_in_force={time_in_force}"));
        }
    }

    pairs.join("&")
}

fn validate_order(order: &OrderRequest) -> Result<(), String> {
    if order.market.trim().is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    if !matches!(order.side.as_str(), "bid" | "ask") {
        return Err("side는 bid 또는 ask만 사용할 수 있습니다.".to_string());
    }

    if !matches!(order.ord_type.as_str(), "limit" | "price" | "market" | "best") {
        return Err("ord_type은 limit, price, market, best만 사용할 수 있습니다.".to_string());
    }

    match (order.side.as_str(), order.ord_type.as_str()) {
        (_, "limit") => {
            require_present("수량", &order.volume)?;
            require_present("가격", &order.price)?;
        }
        ("bid", "price") => {
            require_present("매수 금액", &order.price)?;
        }
        ("ask", "market") => {
            require_present("매도 수량", &order.volume)?;
        }
        ("bid", "market") => {
            return Err("업비트 시장가 매수는 ord_type=price와 매수 금액 price를 사용하세요.".to_string());
        }
        ("ask", "price") => {
            return Err("업비트 시장가 매도는 ord_type=market과 매도 수량 volume을 사용하세요.".to_string());
        }
        _ => {}
    }

    Ok(())
}

fn require_present(label: &str, value: &Option<String>) -> Result<(), String> {
    if value
        .as_ref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        return Err(format!("{label}을 입력하세요."));
    }

    Ok(())
}

#[tauri::command]
async fn get_ticker(markets: String) -> Result<Value, String> {
    let markets = markets.trim().to_uppercase();
    if markets.is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    let url = format!("{UPBIT_BASE_URL}/v1/ticker?markets={markets}");
    Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("시세 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("시세 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("시세 파싱 실패: {error}"))
}

#[tauri::command]
async fn get_quote_tickers(quote_currencies: String) -> Result<Value, String> {
    let quote_currencies = quote_currencies.trim().to_uppercase();
    if quote_currencies.is_empty() {
        return Err("조회할 기준 통화를 입력하세요. 예: KRW,BTC,USDT".to_string());
    }

    let url = format!("{UPBIT_BASE_URL}/v1/ticker/all?quote_currencies={quote_currencies}");
    Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("전체 현재가 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("전체 현재가 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("전체 현재가 파싱 실패: {error}"))
}

#[tauri::command]
async fn get_markets(is_details: Option<bool>) -> Result<Value, String> {
    let url = format!(
        "{UPBIT_BASE_URL}/v1/market/all?is_details={}",
        is_details.unwrap_or(false)
    );

    Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("마켓 목록 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("마켓 목록 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("마켓 목록 파싱 실패: {error}"))
}

#[tauri::command]
async fn get_candles(
    market: String,
    timeframe: String,
    count: Option<u16>,
) -> Result<Value, String> {
    let market = market.trim().to_uppercase();
    if market.is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    let path = match timeframe.trim().to_lowercase().as_str() {
        "seconds" => "candles/seconds".to_string(),
        "1m" => "candles/minutes/1".to_string(),
        "3m" => "candles/minutes/3".to_string(),
        "5m" => "candles/minutes/5".to_string(),
        "10m" => "candles/minutes/10".to_string(),
        "15m" => "candles/minutes/15".to_string(),
        "30m" => "candles/minutes/30".to_string(),
        "60m" => "candles/minutes/60".to_string(),
        "240m" => "candles/minutes/240".to_string(),
        "1d" => "candles/days".to_string(),
        "1w" => "candles/weeks".to_string(),
        "1mo" => "candles/months".to_string(),
        "1y" => "candles/years".to_string(),
        _ => return Err("지원하지 않는 차트 주기입니다.".to_string()),
    };

    let count = count.unwrap_or(100).clamp(1, 200).to_string();
    let url = format!("{UPBIT_BASE_URL}/v1/{path}");

    Client::new()
        .get(url)
        .query(&[("market", market.as_str()), ("count", count.as_str())])
        .send()
        .await
        .map_err(|error| format!("캔들 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("캔들 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("캔들 파싱 실패: {error}"))
}

async fn fetch_accounts(keys: &ApiKeys) -> Result<Value, String> {
    let authorization = auth_header(keys, None)?;

    Client::new()
        .get(format!("{UPBIT_BASE_URL}/v1/accounts"))
        .header("Authorization", authorization)
        .send()
        .await
        .map_err(|error| format!("잔고 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("잔고 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("잔고 파싱 실패: {error}"))
}

#[tauri::command]
async fn get_accounts(keys: ApiKeys) -> Result<Value, String> {
    fetch_accounts(&keys).await
}

#[tauri::command]
fn set_session_api_keys(
    keys: ApiKeys,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<(), String> {
    let access_key = keys.access_key.trim().to_string();
    let secret_key = keys.secret_key.trim().to_string();

    if access_key.is_empty() || secret_key.is_empty() {
        return Err("API Key를 먼저 입력하세요.".to_string());
    }

    let mut guard = session_keys
        .lock()
        .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
    *guard = Some(ApiKeys {
        access_key,
        secret_key,
    });

    Ok(())
}

#[tauri::command]
fn has_session_api_keys(session_keys: tauri::State<'_, SessionApiKeys>) -> Result<bool, String> {
    let guard = session_keys
        .lock()
        .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;

    Ok(guard
        .as_ref()
        .map(|keys| !keys.access_key.trim().is_empty() && !keys.secret_key.trim().is_empty())
        .unwrap_or(false))
}

#[tauri::command]
async fn get_session_accounts(session_keys: tauri::State<'_, SessionApiKeys>) -> Result<Value, String> {
    let keys = {
        let guard = session_keys
            .lock()
            .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "API Key를 먼저 입력하세요.".to_string())?
    };

    fetch_accounts(&keys).await
}

#[tauri::command]
async fn get_order_chance(keys: ApiKeys, market: String) -> Result<Value, String> {
    let market = market.trim().to_uppercase();
    if market.is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    let query_string = format!("market={market}");
    let authorization = auth_header(&keys, Some(&query_string))?;

    Client::new()
        .get(format!("{UPBIT_BASE_URL}/v1/orders/chance?{query_string}"))
        .header("Authorization", authorization)
        .send()
        .await
        .map_err(|error| format!("주문 가능정보 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("주문 가능정보 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("주문 가능정보 파싱 실패: {error}"))
}

#[tauri::command]
async fn place_order(keys: ApiKeys, order: OrderRequest, dry_run: bool) -> Result<Value, String> {
    validate_order(&order)?;
    let query_string = order_query_string(&order);

    if dry_run {
        return Ok(json!({
            "dry_run": true,
            "query_string": query_string,
            "order": order,
            "message": "모의 실행입니다. 업비트로 주문을 전송하지 않았습니다."
        }));
    }

    let authorization = auth_header(&keys, Some(&query_string))?;

    Client::new()
        .post(format!("{UPBIT_BASE_URL}/v1/orders"))
        .header("Authorization", authorization)
        .json(&order)
        .send()
        .await
        .map_err(|error| format!("주문 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("주문 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("주문 응답 파싱 실패: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(None::<ApiKeys>))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_ticker,
            get_quote_tickers,
            get_markets,
            get_candles,
            get_accounts,
            set_session_api_keys,
            has_session_api_keys,
            get_session_accounts,
            get_order_chance,
            place_order
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
