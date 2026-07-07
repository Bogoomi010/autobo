use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha512};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

const UPBIT_BASE_URL: &str = "https://api.upbit.com";
const UPBIT_WEBSOCKET_URL: &str = "wss://api.upbit.com/websocket/v1";
type SessionApiKeys = Mutex<Option<ApiKeys>>;
type TradeStreamState = Mutex<Option<JoinHandle<()>>>;

struct OrderbookStreamState(Mutex<Option<JoinHandle<()>>>);

#[derive(Debug, Serialize, Deserialize)]
struct JwtClaims {
    access_key: String,
    nonce: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_hash_alg: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
struct UpbitTradeMessage {
    code: String,
    trade_price: f64,
    trade_volume: f64,
    #[serde(default)]
    trade_timestamp: Option<i64>,
    #[serde(default)]
    ask_bid: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct UpbitOrderbookUnit {
    ask_price: f64,
    bid_price: f64,
    ask_size: f64,
    bid_size: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct UpbitOrderbookMessage {
    code: String,
    #[serde(default)]
    timestamp: Option<i64>,
    #[serde(default)]
    total_ask_size: f64,
    #[serde(default)]
    total_bid_size: f64,
    orderbook_units: Vec<UpbitOrderbookUnit>,
}

#[derive(Debug, Clone, Serialize)]
struct OrderbookSnapshot {
    market: String,
    best_ask_price: f64,
    best_bid_price: f64,
    best_ask_size: f64,
    best_bid_size: f64,
    total_ask_size: f64,
    total_bid_size: f64,
    spread: f64,
    spread_rate: f64,
    orderbook_units: Vec<UpbitOrderbookUnit>,
    received_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    exchange_timestamp: Option<i64>,
}

impl OrderbookSnapshot {
    fn from_message(message: UpbitOrderbookMessage) -> Option<Self> {
        let best_unit = message.orderbook_units.first()?.clone();
        let mid_price = (best_unit.ask_price + best_unit.bid_price) / 2.0;
        let spread = best_unit.ask_price - best_unit.bid_price;
        let spread_rate = if mid_price > 0.0 {
            spread / mid_price
        } else {
            0.0
        };

        Some(Self {
            market: message.code,
            best_ask_price: best_unit.ask_price,
            best_bid_price: best_unit.bid_price,
            best_ask_size: best_unit.ask_size,
            best_bid_size: best_unit.bid_size,
            total_ask_size: message.total_ask_size,
            total_bid_size: message.total_bid_size,
            spread,
            spread_rate,
            orderbook_units: message.orderbook_units,
            received_at: unix_timestamp_millis(),
            exchange_timestamp: message.timestamp,
        })
    }
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
struct TradeVolumeSnapshot {
    market: String,
    last_trade_price: f64,
    last_trade_volume: f64,
    accumulated_volume: f64,
    accumulated_trade_value: f64,
    accumulated_bid_volume: f64,
    accumulated_ask_volume: f64,
    accumulated_bid_trade_value: f64,
    accumulated_ask_trade_value: f64,
    trade_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_trade_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask_bid: Option<String>,
}

impl TradeVolumeSnapshot {
    fn from_trade(message: &UpbitTradeMessage) -> Self {
        let trade_value = message.trade_price * message.trade_volume;
        let is_bid = message.ask_bid.as_deref() == Some("BID");
        let is_ask = message.ask_bid.as_deref() == Some("ASK");

        Self {
            market: message.code.clone(),
            last_trade_price: message.trade_price,
            last_trade_volume: message.trade_volume,
            accumulated_volume: message.trade_volume,
            accumulated_trade_value: trade_value,
            accumulated_bid_volume: if is_bid { message.trade_volume } else { 0.0 },
            accumulated_ask_volume: if is_ask { message.trade_volume } else { 0.0 },
            accumulated_bid_trade_value: if is_bid { trade_value } else { 0.0 },
            accumulated_ask_trade_value: if is_ask { trade_value } else { 0.0 },
            trade_count: 1,
            last_trade_timestamp: message.trade_timestamp,
            ask_bid: message.ask_bid.clone(),
        }
    }

    fn add_trade(&mut self, message: &UpbitTradeMessage) {
        let trade_value = message.trade_price * message.trade_volume;
        self.last_trade_price = message.trade_price;
        self.last_trade_volume = message.trade_volume;
        self.accumulated_volume += message.trade_volume;
        self.accumulated_trade_value += trade_value;
        match message.ask_bid.as_deref() {
            Some("BID") => {
                self.accumulated_bid_volume += message.trade_volume;
                self.accumulated_bid_trade_value += trade_value;
            }
            Some("ASK") => {
                self.accumulated_ask_volume += message.trade_volume;
                self.accumulated_ask_trade_value += trade_value;
            }
            _ => {}
        }
        self.trade_count += 1;
        self.last_trade_timestamp = message.trade_timestamp;
        self.ask_bid = message.ask_bid.clone();
    }
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

fn upbitkey_path() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("실행 파일 경로를 확인할 수 없습니다: {error}"))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "실행 파일 폴더를 확인할 수 없습니다.".to_string())?;

    Ok(exe_dir.join("upbitkey"))
}

fn parse_upbitkey_contents(contents: &str) -> Result<ApiKeys, String> {
    let mut access_key: Option<String> = None;
    let mut secret_key: Option<String> = None;
    let mut pending_label: Option<&str> = None;

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let normalized = line
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>()
            .to_ascii_lowercase();

        if normalized == "accesskey" {
            pending_label = Some("access");
            continue;
        }

        if normalized == "secretkey" {
            pending_label = Some("secret");
            continue;
        }

        match pending_label.take() {
            Some("access") => access_key = Some(line.to_string()),
            Some("secret") => secret_key = Some(line.to_string()),
            _ => {}
        }
    }

    let access_key = access_key
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "upbitkey 파일에서 Access key를 찾을 수 없습니다.".to_string())?;
    let secret_key = secret_key
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "upbitkey 파일에서 Secret key를 찾을 수 없습니다.".to_string())?;

    Ok(ApiKeys {
        access_key,
        secret_key,
    })
}

fn load_upbitkey() -> Result<ApiKeys, String> {
    let path = upbitkey_path()?;
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("upbitkey 파일을 읽을 수 없습니다: {error}"))?;

    parse_upbitkey_contents(&contents)
}

// ---------- API Key 암호화 저장 (ROOT/upbitkey.enc) ----------

const KEY_FILE_MAGIC: &[u8] = b"AUTOBOKEY1";
const NONCE_LEN: usize = 12;

fn encrypted_key_path() -> Result<PathBuf, String> {
    Ok(upbitkey_path()?.with_file_name("upbitkey.enc"))
}

/// 머신 종속 암호화 키 유도 — upbitkey.enc를 다른 PC로 복사해도 복호화되지 않는다.
fn encryption_key() -> [u8; 32] {
    let computer = std::env::var("COMPUTERNAME").unwrap_or_default();
    let user = std::env::var("USERNAME").unwrap_or_default();

    let mut hasher = Sha512::new();
    hasher.update(b"autobo-upbitkey-v1");
    hasher.update(computer.as_bytes());
    hasher.update(user.as_bytes());
    let digest = hasher.finalize();

    let mut key = [0u8; 32];
    key.copy_from_slice(&digest[..32]);
    key
}

fn encrypt_keys(keys: &ApiKeys, encryption_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let plaintext =
        serde_json::to_vec(keys).map_err(|error| format!("API Key 직렬화 실패: {error}"))?;

    let cipher = Aes256Gcm::new_from_slice(encryption_key)
        .map_err(|_| "API Key 암호화 키 생성에 실패했습니다.".to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_slice())
        .map_err(|_| "API Key 암호화에 실패했습니다.".to_string())?;

    let mut contents = Vec::with_capacity(KEY_FILE_MAGIC.len() + NONCE_LEN + ciphertext.len());
    contents.extend_from_slice(KEY_FILE_MAGIC);
    contents.extend_from_slice(&nonce);
    contents.extend_from_slice(&ciphertext);
    Ok(contents)
}

fn decrypt_keys(contents: &[u8], encryption_key: &[u8; 32]) -> Result<ApiKeys, String> {
    let payload = contents
        .strip_prefix(KEY_FILE_MAGIC)
        .ok_or_else(|| "upbitkey.enc 파일 형식이 올바르지 않습니다.".to_string())?;
    if payload.len() <= NONCE_LEN {
        return Err("upbitkey.enc 파일이 손상되었습니다.".to_string());
    }

    let (nonce, ciphertext) = payload.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(encryption_key)
        .map_err(|_| "API Key 암호화 키 생성에 실패했습니다.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| {
            "API Key 복호화에 실패했습니다. 키를 다시 입력하세요. (다른 PC에서 만든 파일은 사용할 수 없습니다)"
                .to_string()
        })?;

    serde_json::from_slice::<ApiKeys>(&plaintext)
        .map_err(|_| "upbitkey.enc 내용이 올바르지 않습니다. 키를 다시 입력하세요.".to_string())
}

fn save_encrypted_keys(keys: &ApiKeys) -> Result<(), String> {
    let contents = encrypt_keys(keys, &encryption_key())?;
    fs::write(encrypted_key_path()?, contents)
        .map_err(|error| format!("API Key 파일 저장 실패: {error}"))
}

/// 저장된 키 로드 — 암호화 파일 우선, 없으면 기존 평문 upbitkey를 암호화 파일로 이전.
fn load_saved_keys() -> Result<ApiKeys, String> {
    let encrypted_path = encrypted_key_path()?;
    if encrypted_path.exists() {
        let contents = fs::read(&encrypted_path)
            .map_err(|error| format!("upbitkey.enc 파일을 읽을 수 없습니다: {error}"))?;
        return decrypt_keys(&contents, &encryption_key());
    }

    let legacy_path = upbitkey_path()?;
    if legacy_path.exists() {
        let keys = load_upbitkey()?;
        // 평문 키를 남기지 않는다 — 암호화 저장 성공 후에만 원본 제거
        save_encrypted_keys(&keys)?;
        let _ = fs::remove_file(&legacy_path);
        return Ok(keys);
    }

    Err("저장된 API Key가 없습니다. Access Key와 Secret Key를 입력하세요.".to_string())
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

    if !matches!(
        order.ord_type.as_str(),
        "limit" | "price" | "market" | "best"
    ) {
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
            return Err(
                "업비트 시장가 매수는 ord_type=price와 매수 금액 price를 사용하세요.".to_string(),
            );
        }
        ("ask", "price") => {
            return Err(
                "업비트 시장가 매도는 ord_type=market과 매도 수량 volume을 사용하세요.".to_string(),
            );
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

fn normalize_krw_markets(markets: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = markets
        .into_iter()
        .map(|market| market.trim().to_uppercase())
        .filter(|market| market.starts_with("KRW-") && market.len() > 4)
        .collect::<Vec<_>>();

    normalized.sort();
    normalized.dedup();

    if normalized.is_empty() {
        return Err("실시간 체결량을 감시할 KRW 마켓이 없습니다.".to_string());
    }

    Ok(normalized)
}

fn parse_trade_message(message: Message) -> Result<Option<UpbitTradeMessage>, String> {
    match message {
        Message::Text(text) => serde_json::from_str::<UpbitTradeMessage>(&text)
            .map(Some)
            .map_err(|error| format!("체결 메시지 파싱 실패: {error}")),
        Message::Binary(bytes) => serde_json::from_slice::<UpbitTradeMessage>(&bytes)
            .map(Some)
            .map_err(|error| format!("체결 메시지 파싱 실패: {error}")),
        Message::Ping(_) | Message::Pong(_) => Ok(None),
        Message::Close(_) => Err("체결 WebSocket 연결이 종료되었습니다.".to_string()),
        _ => Ok(None),
    }
}

fn parse_orderbook_message(message: Message) -> Result<Option<OrderbookSnapshot>, String> {
    let parsed = match message {
        Message::Text(text) => serde_json::from_str::<UpbitOrderbookMessage>(&text)
            .map_err(|error| format!("호가 메시지 파싱 실패: {error}"))?,
        Message::Binary(bytes) => serde_json::from_slice::<UpbitOrderbookMessage>(&bytes)
            .map_err(|error| format!("호가 메시지 파싱 실패: {error}"))?,
        Message::Ping(_) | Message::Pong(_) => return Ok(None),
        Message::Close(_) => return Err("호가 WebSocket 연결이 종료되었습니다.".to_string()),
        _ => return Ok(None),
    };

    Ok(OrderbookSnapshot::from_message(parsed))
}

async fn run_trade_volume_stream(app: AppHandle, markets: Vec<String>) {
    let mut reconnect_delay = Duration::from_secs(1);
    let mut snapshots: HashMap<String, TradeVolumeSnapshot> = HashMap::new();

    loop {
        let connection = connect_async(UPBIT_WEBSOCKET_URL).await;
        let (mut websocket, _) = match connection {
            Ok(connection) => connection,
            Err(error) => {
                let _ = app.emit(
                    "trade-volume-status",
                    format!("체결 WebSocket 연결 실패: {error}"),
                );
                tokio::time::sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        reconnect_delay = Duration::from_secs(1);
        let request = json!([
            { "ticket": Uuid::new_v4().to_string() },
            { "type": "trade", "codes": &markets },
            { "format": "DEFAULT" }
        ]);

        if let Err(error) = websocket.send(Message::Text(request.to_string())).await {
            let _ = app.emit(
                "trade-volume-status",
                format!("체결 WebSocket 구독 실패: {error}"),
            );
            tokio::time::sleep(reconnect_delay).await;
            continue;
        }

        let _ = app.emit("trade-volume-status", "체결 WebSocket 연결됨");
        let mut last_snapshot_emit = Instant::now();

        loop {
            let message = tokio::time::timeout(Duration::from_secs(1), websocket.next()).await;
            match message {
                Ok(Some(Ok(message))) => match parse_trade_message(message) {
                    Ok(Some(trade)) => {
                        snapshots
                            .entry(trade.code.clone())
                            .and_modify(|snapshot| snapshot.add_trade(&trade))
                            .or_insert_with(|| TradeVolumeSnapshot::from_trade(&trade));
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = app.emit("trade-volume-status", error);
                        break;
                    }
                },
                Ok(Some(Err(error))) => {
                    let _ = app.emit(
                        "trade-volume-status",
                        format!("체결 WebSocket 수신 실패: {error}"),
                    );
                    break;
                }
                Ok(None) => break,
                Err(_) => {}
            }

            if !snapshots.is_empty() && last_snapshot_emit.elapsed() >= Duration::from_secs(1) {
                let payload = markets
                    .iter()
                    .filter_map(|market| snapshots.get(market))
                    .cloned()
                    .collect::<Vec<_>>();
                let _ = app.emit("trade-volume-snapshot", payload);
                last_snapshot_emit = Instant::now();
            }
        }

        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
    }
}

async fn run_orderbook_stream(app: AppHandle, market: String) {
    let mut reconnect_delay = Duration::from_secs(1);

    loop {
        let connection = connect_async(UPBIT_WEBSOCKET_URL).await;
        let (mut websocket, _) = match connection {
            Ok(connection) => connection,
            Err(error) => {
                let _ = app.emit(
                    "orderbook-status",
                    format!("호가 WebSocket 연결 실패: {error}"),
                );
                tokio::time::sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        reconnect_delay = Duration::from_secs(1);
        let request = json!([
            { "ticket": Uuid::new_v4().to_string() },
            { "type": "orderbook", "codes": [&market] },
            { "format": "DEFAULT" }
        ]);

        if let Err(error) = websocket.send(Message::Text(request.to_string())).await {
            let _ = app.emit("orderbook-status", format!("호가 WebSocket 구독 실패: {error}"));
            tokio::time::sleep(reconnect_delay).await;
            continue;
        }

        let _ = app.emit("orderbook-status", "호가 WebSocket 연결됨");
        let mut last_snapshot_emit = Instant::now();
        let mut latest_snapshot: Option<OrderbookSnapshot> = None;

        loop {
            let message = tokio::time::timeout(Duration::from_secs(1), websocket.next()).await;
            match message {
                Ok(Some(Ok(message))) => match parse_orderbook_message(message) {
                    Ok(Some(snapshot)) => {
                        latest_snapshot = Some(snapshot);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = app.emit("orderbook-status", error);
                        break;
                    }
                },
                Ok(Some(Err(error))) => {
                    let _ = app.emit("orderbook-status", format!("호가 WebSocket 수신 실패: {error}"));
                    break;
                }
                Ok(None) => break,
                Err(_) => {}
            }

            if let Some(snapshot) = latest_snapshot.as_ref() {
                if last_snapshot_emit.elapsed() >= Duration::from_millis(500) {
                    let _ = app.emit("orderbook-snapshot", snapshot);
                    last_snapshot_emit = Instant::now();
                }
            }
        }

        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
    }
}

#[tauri::command]
async fn start_trade_volume_stream(
    app: AppHandle,
    markets: Vec<String>,
    trade_stream: tauri::State<'_, TradeStreamState>,
) -> Result<(), String> {
    let markets = normalize_krw_markets(markets)?;
    let mut guard = trade_stream
        .lock()
        .map_err(|_| "체결 WebSocket 상태를 사용할 수 없습니다.".to_string())?;

    if let Some(handle) = guard.take() {
        handle.abort();
    }

    *guard = Some(tauri::async_runtime::spawn(run_trade_volume_stream(
        app, markets,
    )));
    Ok(())
}

#[tauri::command]
async fn start_orderbook_stream(
    app: AppHandle,
    market: String,
    orderbook_stream: tauri::State<'_, OrderbookStreamState>,
) -> Result<(), String> {
    let market = market.trim().to_uppercase();
    if !market.starts_with("KRW-") || market.len() <= 4 {
        return Err("호가를 감시할 KRW 마켓을 선택하세요.".to_string());
    }

    let mut guard = orderbook_stream
        .0
        .lock()
        .map_err(|_| "호가 WebSocket 상태를 사용할 수 없습니다.".to_string())?;

    if let Some(handle) = guard.take() {
        handle.abort();
    }

    *guard = Some(tauri::async_runtime::spawn(run_orderbook_stream(
        app, market,
    )));
    Ok(())
}

#[tauri::command]
async fn stop_orderbook_stream(
    orderbook_stream: tauri::State<'_, OrderbookStreamState>,
) -> Result<(), String> {
    let mut guard = orderbook_stream
        .0
        .lock()
        .map_err(|_| "호가 WebSocket 상태를 사용할 수 없습니다.".to_string())?;

    if let Some(handle) = guard.take() {
        handle.abort();
    }

    Ok(())
}

#[tauri::command]
async fn stop_trade_volume_stream(
    trade_stream: tauri::State<'_, TradeStreamState>,
) -> Result<(), String> {
    let mut guard = trade_stream
        .lock()
        .map_err(|_| "체결 WebSocket 상태를 사용할 수 없습니다.".to_string())?;

    if let Some(handle) = guard.take() {
        handle.abort();
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
        return Err("조회할 기준 통화를 입력하세요. 예: KRW".to_string());
    }

    if quote_currencies != "KRW" {
        return Err("Autobo는 KRW 마켓 현재가만 조회합니다.".to_string());
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
fn has_saved_keys() -> bool {
    encrypted_key_path()
        .map(|path| path.exists())
        .unwrap_or(false)
        || upbitkey_path().map(|path| path.exists()).unwrap_or(false)
}

#[tauri::command]
async fn save_api_keys(
    access_key: String,
    secret_key: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let keys = ApiKeys {
        access_key: access_key.trim().to_string(),
        secret_key: secret_key.trim().to_string(),
    };
    if keys.access_key.is_empty() || keys.secret_key.is_empty() {
        return Err("Access Key와 Secret Key를 모두 입력하세요.".to_string());
    }

    // 잔고 조회로 키 유효성을 먼저 검증 — 잘못된 키는 저장하지 않는다
    let accounts = fetch_accounts(&keys).await?;
    save_encrypted_keys(&keys)?;

    let mut guard = session_keys
        .lock()
        .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
    *guard = Some(keys);

    Ok(accounts)
}

#[tauri::command]
async fn connect_upbitkey_account(
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let keys = load_saved_keys()?;
    let accounts = fetch_accounts(&keys).await?;

    let mut guard = session_keys
        .lock()
        .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
    *guard = Some(keys);

    Ok(accounts)
}

#[tauri::command]
async fn get_session_accounts(
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
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
async fn get_order_chance(
    market: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let market = market.trim().to_uppercase();
    if market.is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    let keys = {
        let guard = session_keys
            .lock()
            .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "API Key를 먼저 연동하세요.".to_string())?
    };

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
async fn get_order(
    uuid: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let uuid = uuid.trim().to_string();
    if uuid.is_empty() {
        return Err("조회할 주문 uuid를 입력하세요.".to_string());
    }

    if !uuid
        .chars()
        .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err("주문 uuid 형식이 올바르지 않습니다.".to_string());
    }

    let keys = {
        let guard = session_keys
            .lock()
            .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "API Key를 먼저 연동하세요.".to_string())?
    };

    let query_string = format!("uuid={uuid}");
    let authorization = auth_header(&keys, Some(&query_string))?;

    Client::new()
        .get(format!("{UPBIT_BASE_URL}/v1/order?{query_string}"))
        .header("Authorization", authorization)
        .send()
        .await
        .map_err(|error| format!("주문 조회 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("주문 조회 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("주문 조회 파싱 실패: {error}"))
}

#[tauri::command]
async fn place_order(
    order: OrderRequest,
    dry_run: bool,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
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

    let keys = {
        let guard = session_keys
            .lock()
            .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "API Key를 먼저 연동하세요.".to_string())?
    };

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
        .manage(Mutex::new(None::<JoinHandle<()>>))
        .manage(OrderbookStreamState(Mutex::new(None::<JoinHandle<()>>)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_ticker,
            get_quote_tickers,
            get_markets,
            get_candles,
            start_trade_volume_stream,
            stop_trade_volume_stream,
            start_orderbook_stream,
            stop_orderbook_stream,
            has_saved_keys,
            save_api_keys,
            connect_upbitkey_account,
            get_session_accounts,
            get_order_chance,
            get_order,
            place_order
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upbitkey_label_value_lines() {
        let keys = parse_upbitkey_contents(
            "Access key \nHgxadfsfda2dsadsadsaxqweNfdcxcnfdasfaso5excxz\r\nSecret key \nnfdasffdN3dsadsadsadczxvcXfdafG85n4Xx\n",
        )
        .expect("keys should parse");

        assert_eq!(
            keys.access_key,
            "Hgxadfsfda2dsadsadsaxqweNfdcxcnfdasfaso5excxz"
        );
        assert_eq!(keys.secret_key, "nfdasffdN3dsadsadsadczxvcXfdafG85n4Xx");
    }

    #[test]
    fn rejects_missing_secret_key() {
        let error = parse_upbitkey_contents("Access key\nabc\n")
            .expect_err("missing secret key should fail");

        assert!(error.contains("Secret key"));
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let keys = ApiKeys {
            access_key: "test-access-key".to_string(),
            secret_key: "test-secret-key".to_string(),
        };
        let encryption_key = [7u8; 32];

        let contents = encrypt_keys(&keys, &encryption_key).expect("encrypt should succeed");
        assert!(contents.starts_with(KEY_FILE_MAGIC));
        // 평문 키가 파일 내용에 그대로 남지 않아야 한다
        assert!(!contents
            .windows(keys.access_key.len())
            .any(|window| window == keys.access_key.as_bytes()));

        let decrypted = decrypt_keys(&contents, &encryption_key).expect("decrypt should succeed");
        assert_eq!(decrypted.access_key, keys.access_key);
        assert_eq!(decrypted.secret_key, keys.secret_key);
    }

    #[test]
    fn rejects_decrypt_with_wrong_key() {
        let keys = ApiKeys {
            access_key: "test-access-key".to_string(),
            secret_key: "test-secret-key".to_string(),
        };

        let contents = encrypt_keys(&keys, &[7u8; 32]).expect("encrypt should succeed");
        decrypt_keys(&contents, &[8u8; 32]).expect_err("wrong key should fail");
    }
}
