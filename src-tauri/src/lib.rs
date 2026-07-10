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
use std::io::Write;
use std::path::PathBuf;
use std::process::Child;
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
struct BackgroundTradingTaskState(Mutex<Option<JoinHandle<()>>>);
struct KeepAwakeState(Mutex<Option<Child>>);

struct OrderbookStreamState(Mutex<Option<JoinHandle<()>>>);
/// 트레이딩 보드 전용 단일 마켓 실시간 체결(틱) 스트림 — 집계 없이 체결 건마다 그대로 프론트에 전달한다
struct BoardTradeStreamState(Mutex<Option<JoinHandle<()>>>);

#[cfg(target_os = "macos")]
fn start_keep_awake() -> Option<Child> {
    std::process::Command::new("/usr/bin/caffeinate")
        .args(["-i", "-w", &std::process::id().to_string()])
        .spawn()
        .ok()
}

#[cfg(not(target_os = "macos"))]
fn start_keep_awake() -> Option<Child> {
    None
}

fn stop_keep_awake(child: &mut Option<Child>) {
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

/// WebView 타이머와 무관한 매수봇 심박을 만들고, macOS에서는 화면 잠금 중 유휴 시스템 절전을 막는다.
#[tauri::command]
fn set_background_trading_active(
    app: AppHandle,
    active: bool,
    task_state: tauri::State<'_, BackgroundTradingTaskState>,
    keep_awake_state: tauri::State<'_, KeepAwakeState>,
) -> Result<(), String> {
    let mut task = task_state
        .0
        .lock()
        .map_err(|_| "백그라운드 매매 상태를 사용할 수 없습니다.".to_string())?;
    let mut keep_awake = keep_awake_state
        .0
        .lock()
        .map_err(|_| "절전 방지 상태를 사용할 수 없습니다.".to_string())?;

    if active {
        if keep_awake.is_none() {
            *keep_awake = start_keep_awake();
        }
        if task.is_none() {
            *task = Some(tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    interval.tick().await;
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let _ = app.emit("bot-background-tick", now);
                }
            }));
        }
    } else {
        if let Some(handle) = task.take() {
            handle.abort();
        }
        stop_keep_awake(&mut keep_awake);
    }

    Ok(())
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiKeyProfile {
    id: String,
    nickname: String,
    access_key: String,
    secret_key: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiKeyProfileStore {
    version: u8,
    profiles: Vec<ApiKeyProfile>,
    selected_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ApiKeyProfileSummary {
    id: String,
    nickname: String,
    access_key_hint: String,
    updated_at: u64,
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

/// 로봇 매수봇 매수/매도 로그 1건. 필드명은 프론트(`BotTradeLogEntry`)와 동일한 snake_case.
#[derive(Debug, Deserialize)]
struct BotTradeLogEntry {
    timestamp: String,
    trade_id: String,
    bot_id: String,
    bot_name: String,
    action: String,
    market: String,
    name_ko: Option<String>,
    mode: String,
    price: f64,
    volume: f64,
    invested_krw: f64,
    pnl_krw: Option<f64>,
    pnl_rate: Option<f64>,
    reason: String,
}

/// 로봇 매수봇 보유 중 시장 스냅샷 1건. 필드명은 프론트(`BotMarketLogEntry`)와 동일한 snake_case.
/// bot_trades_log.csv와 trade_id로 조인해 거래 종료 후 시장 상황 대 수익결과를 비교하는 데 쓴다.
#[derive(Debug, Deserialize)]
struct BotMarketLogEntry {
    timestamp: String,
    trade_id: String,
    bot_id: String,
    bot_name: String,
    market: String,
    mode: String,
    price: f64,
    pnl_rate: f64,
    trade_value_accel: f64,
    bid_ratio: f64,
    collapse_score: f64,
    retracement: f64,
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
    #[serde(default)]
    sequential_id: Option<i64>,
}

/// 트레이딩 보드로 그대로 내보내는 체결 한 건 (프론트 TradeTick과 1:1 대응)
#[derive(Debug, Clone, Serialize)]
struct BoardTradeTick {
    id: String,
    time: i64,
    price: f64,
    volume: f64,
    side: String,
}

impl From<UpbitTradeMessage> for BoardTradeTick {
    fn from(message: UpbitTradeMessage) -> Self {
        let time = message.trade_timestamp.unwrap_or_default();
        Self {
            id: message
                .sequential_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| time.to_string()),
            time,
            price: message.trade_price,
            volume: message.trade_volume,
            side: match message.ask_bid.as_deref() {
                Some("BID") => "bid".to_string(),
                _ => "ask".to_string(),
            },
        }
    }
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn default_profile_nickname() -> String {
    "기본 프로필".to_string()
}

fn normalize_profile_nickname(nickname: &str) -> Result<String, String> {
    let trimmed = nickname.trim();
    if trimmed.is_empty() {
        return Err("프로필 닉네임을 입력하세요.".to_string());
    }
    if trimmed.chars().count() > 24 {
        return Err("프로필 닉네임은 24자 이하로 입력하세요.".to_string());
    }
    Ok(trimmed.to_string())
}

fn mask_access_key(access_key: &str) -> String {
    let trimmed = access_key.trim();
    let total = trimmed.chars().count();
    if total <= 4 {
        return "****".to_string();
    }
    let tail = trimmed
        .chars()
        .skip(total.saturating_sub(4))
        .collect::<String>();
    format!("****{tail}")
}

fn profile_summary(profile: &ApiKeyProfile) -> ApiKeyProfileSummary {
    ApiKeyProfileSummary {
        id: profile.id.clone(),
        nickname: profile.nickname.clone(),
        access_key_hint: mask_access_key(&profile.access_key),
        updated_at: profile.updated_at,
    }
}

fn keys_to_profile(keys: ApiKeys, nickname: String) -> ApiKeyProfile {
    let now = now_ms();
    ApiKeyProfile {
        id: Uuid::new_v4().to_string(),
        nickname,
        access_key: keys.access_key,
        secret_key: keys.secret_key,
        created_at: now,
        updated_at: now,
    }
}

fn profiles_from_legacy_keys(keys: ApiKeys) -> ApiKeyProfileStore {
    let profile = keys_to_profile(keys, default_profile_nickname());
    ApiKeyProfileStore {
        selected_profile_id: Some(profile.id.clone()),
        profiles: vec![profile],
        version: 2,
    }
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

fn encrypt_plaintext(plaintext: &[u8], encryption_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(encryption_key)
        .map_err(|_| "API Key 암호화 키 생성에 실패했습니다.".to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| "API Key 암호화에 실패했습니다.".to_string())?;

    let mut contents = Vec::with_capacity(KEY_FILE_MAGIC.len() + NONCE_LEN + ciphertext.len());
    contents.extend_from_slice(KEY_FILE_MAGIC);
    contents.extend_from_slice(&nonce);
    contents.extend_from_slice(&ciphertext);
    Ok(contents)
}

#[cfg(test)]
fn encrypt_keys(keys: &ApiKeys, encryption_key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let plaintext =
        serde_json::to_vec(keys).map_err(|error| format!("API Key 직렬화 실패: {error}"))?;
    encrypt_plaintext(&plaintext, encryption_key)
}

fn encrypt_profile_store(
    store: &ApiKeyProfileStore,
    encryption_key: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let plaintext = serde_json::to_vec(store)
        .map_err(|error| format!("API Key 프로필 직렬화 실패: {error}"))?;
    encrypt_plaintext(&plaintext, encryption_key)
}

fn decrypt_plaintext(contents: &[u8], encryption_key: &[u8; 32]) -> Result<Vec<u8>, String> {
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
    Ok(plaintext)
}

#[cfg(test)]
fn decrypt_keys(contents: &[u8], encryption_key: &[u8; 32]) -> Result<ApiKeys, String> {
    let plaintext = decrypt_plaintext(contents, encryption_key)?;
    serde_json::from_slice::<ApiKeys>(&plaintext)
        .map_err(|_| "upbitkey.enc 내용이 올바르지 않습니다. 키를 다시 입력하세요.".to_string())
}

fn decrypt_profile_store(
    contents: &[u8],
    encryption_key: &[u8; 32],
) -> Result<(ApiKeyProfileStore, bool), String> {
    let plaintext = decrypt_plaintext(contents, encryption_key)?;
    if let Ok(store) = serde_json::from_slice::<ApiKeyProfileStore>(&plaintext) {
        return Ok((store, false));
    }
    let keys = serde_json::from_slice::<ApiKeys>(&plaintext)
        .map_err(|_| "upbitkey.enc 내용이 올바르지 않습니다. 키를 다시 입력하세요.".to_string())?;
    Ok((profiles_from_legacy_keys(keys), true))
}

fn save_profile_store(store: &ApiKeyProfileStore) -> Result<(), String> {
    let contents = encrypt_profile_store(store, &encryption_key())?;
    fs::write(encrypted_key_path()?, contents)
        .map_err(|error| format!("API Key 프로필 파일 저장 실패: {error}"))
}

fn load_profile_store() -> Result<ApiKeyProfileStore, String> {
    let encrypted_path = encrypted_key_path()?;
    if encrypted_path.exists() {
        let contents = fs::read(&encrypted_path)
            .map_err(|error| format!("upbitkey.enc 파일을 읽을 수 없습니다: {error}"))?;
        let (store, migrated) = decrypt_profile_store(&contents, &encryption_key())?;
        if migrated {
            save_profile_store(&store)?;
        }
        return Ok(store);
    }

    let legacy_path = upbitkey_path()?;
    if legacy_path.exists() {
        let store = profiles_from_legacy_keys(load_upbitkey()?);
        // 평문 키를 남기지 않는다 — 암호화 저장 성공 후에만 원본 제거
        save_profile_store(&store)?;
        let _ = fs::remove_file(&legacy_path);
        return Ok(store);
    }

    Ok(ApiKeyProfileStore {
        version: 2,
        profiles: Vec::new(),
        selected_profile_id: None,
    })
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

/// 트레이딩 보드 전용 — 단일 마켓의 체결을 집계/스로틀 없이 건마다 즉시 emit한다(캔들 틱 단위 갱신용).
async fn run_board_trade_stream(app: AppHandle, market: String) {
    let mut reconnect_delay = Duration::from_secs(1);

    loop {
        let connection = connect_async(UPBIT_WEBSOCKET_URL).await;
        let (mut websocket, _) = match connection {
            Ok(connection) => connection,
            Err(error) => {
                let _ = app.emit("board-trade-status", format!("체결 스트림 연결 실패: {error}"));
                tokio::time::sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        reconnect_delay = Duration::from_secs(1);
        let request = json!([
            { "ticket": Uuid::new_v4().to_string() },
            { "type": "trade", "codes": [&market] },
            { "format": "DEFAULT" }
        ]);

        if let Err(error) = websocket.send(Message::Text(request.to_string())).await {
            let _ = app.emit("board-trade-status", format!("체결 스트림 구독 실패: {error}"));
            tokio::time::sleep(reconnect_delay).await;
            continue;
        }

        let _ = app.emit("board-trade-status", "연결됨");

        loop {
            let message = tokio::time::timeout(Duration::from_secs(1), websocket.next()).await;
            match message {
                Ok(Some(Ok(message))) => match parse_trade_message(message) {
                    Ok(Some(trade)) => {
                        let _ = app.emit("board-trade-tick", BoardTradeTick::from(trade));
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = app.emit("board-trade-status", error);
                        break;
                    }
                },
                Ok(Some(Err(error))) => {
                    let _ = app.emit("board-trade-status", format!("체결 스트림 수신 실패: {error}"));
                    break;
                }
                Ok(None) => break,
                Err(_) => {} // idle timeout — 루프 유지, 연결은 살아있음
            }
        }

        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(30));
    }
}

#[tauri::command]
async fn start_board_trade_stream(
    app: AppHandle,
    market: String,
    board_trade_stream: tauri::State<'_, BoardTradeStreamState>,
) -> Result<(), String> {
    let market = market.trim().to_uppercase();
    if !market.starts_with("KRW-") || market.len() <= 4 {
        return Err("체결을 감시할 KRW 마켓을 선택하세요.".to_string());
    }

    let mut guard = board_trade_stream
        .0
        .lock()
        .map_err(|_| "체결 스트림 상태를 사용할 수 없습니다.".to_string())?;

    if let Some(handle) = guard.take() {
        handle.abort();
    }

    *guard = Some(tauri::async_runtime::spawn(run_board_trade_stream(
        app, market,
    )));
    Ok(())
}

#[tauri::command]
async fn stop_board_trade_stream(
    board_trade_stream: tauri::State<'_, BoardTradeStreamState>,
) -> Result<(), String> {
    let mut guard = board_trade_stream
        .0
        .lock()
        .map_err(|_| "체결 스트림 상태를 사용할 수 없습니다.".to_string())?;

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
    to: Option<String>,
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

    // to: 이 시각(UTC ISO 8601) 이전 캔들을 조회 — 과거 스크롤 시 페이지네이션 커서로 사용
    let mut query: Vec<(&str, &str)> = vec![("market", market.as_str()), ("count", count.as_str())];
    if let Some(to) = to.as_deref() {
        if !to.trim().is_empty() {
            query.push(("to", to));
        }
    }

    Client::new()
        .get(url)
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("캔들 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("캔들 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("캔들 파싱 실패: {error}"))
}

#[tauri::command]
async fn get_trades(market: String, count: Option<u16>) -> Result<Value, String> {
    let market = market.trim().to_uppercase();
    if market.is_empty() {
        return Err("마켓을 입력하세요. 예: KRW-BTC".to_string());
    }

    let count = count.unwrap_or(30).clamp(1, 500).to_string();
    let url = format!("{UPBIT_BASE_URL}/v1/trades/ticks");

    Client::new()
        .get(url)
        .query(&[("market", market.as_str()), ("count", count.as_str())])
        .send()
        .await
        .map_err(|error| format!("체결 내역 요청 실패: {error}"))?
        .error_for_status()
        .map_err(|error| format!("체결 내역 응답 오류: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("체결 내역 파싱 실패: {error}"))
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

// ---------- 로봇 매수봇 매수/매도 로그 (ROOT/bot_trades_log.csv, 누적 기록) ----------

fn bot_log_path(filename: &str) -> Result<PathBuf, String> {
    Ok(upbitkey_path()?.with_file_name(filename))
}

/// CSV 필드 이스케이프 — 큰따옴표로 감싸고 내부 큰따옴표는 두 번 반복
fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn opt_f64_field(value: Option<f64>) -> String {
    value.map(|v| v.to_string()).unwrap_or_default()
}

/// CSV에 한 행을 추가한다. 파일이 없으면 만들고 헤더부터 쓴다(누적 기록 전제, 로테이션 없음).
fn append_csv_row(path: &PathBuf, header: &str, row_fields: &[String]) -> Result<(), String> {
    let is_new = !path.exists();

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("로그 파일을 열 수 없습니다: {error}"))?;

    if is_new {
        writeln!(file, "{header}").map_err(|error| format!("로그 헤더 기록 실패: {error}"))?;
    }

    writeln!(file, "{}", row_fields.join(","))
        .map_err(|error| format!("로그 기록 실패: {error}"))?;

    Ok(())
}

#[tauri::command]
fn log_bot_trade(entry: BotTradeLogEntry) -> Result<(), String> {
    let path = bot_log_path("bot_trades_log.csv")?;
    let header = "timestamp,trade_id,bot_id,bot_name,action,market,name_ko,mode,price,volume,invested_krw,pnl_krw,pnl_rate,reason";
    let row = vec![
        csv_field(&entry.timestamp),
        csv_field(&entry.trade_id),
        csv_field(&entry.bot_id),
        csv_field(&entry.bot_name),
        csv_field(&entry.action),
        csv_field(&entry.market),
        csv_field(entry.name_ko.as_deref().unwrap_or("")),
        csv_field(&entry.mode),
        entry.price.to_string(),
        entry.volume.to_string(),
        entry.invested_krw.to_string(),
        opt_f64_field(entry.pnl_krw),
        opt_f64_field(entry.pnl_rate),
        csv_field(&entry.reason),
    ];
    append_csv_row(&path, header, &row)
}

#[tauri::command]
fn log_market_snapshot(entry: BotMarketLogEntry) -> Result<(), String> {
    let path = bot_log_path("bot_market_log.csv")?;
    let header =
        "timestamp,trade_id,bot_id,bot_name,market,mode,price,pnl_rate,trade_value_accel,bid_ratio,collapse_score,retracement";
    let row = vec![
        csv_field(&entry.timestamp),
        csv_field(&entry.trade_id),
        csv_field(&entry.bot_id),
        csv_field(&entry.bot_name),
        csv_field(&entry.market),
        csv_field(&entry.mode),
        entry.price.to_string(),
        entry.pnl_rate.to_string(),
        entry.trade_value_accel.to_string(),
        entry.bid_ratio.to_string(),
        entry.collapse_score.to_string(),
        entry.retracement.to_string(),
    ];
    append_csv_row(&path, header, &row)
}

#[tauri::command]
fn has_saved_keys() -> bool {
    load_profile_store()
        .map(|store| !store.profiles.is_empty())
        .unwrap_or(false)
}

#[tauri::command]
fn list_api_key_profiles() -> Result<Vec<ApiKeyProfileSummary>, String> {
    let store = load_profile_store()?;
    Ok(store.profiles.iter().map(profile_summary).collect())
}

async fn save_profile_and_connect(
    nickname: String,
    access_key: String,
    secret_key: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let nickname = normalize_profile_nickname(&nickname)?;
    let keys = ApiKeys {
        access_key: access_key.trim().to_string(),
        secret_key: secret_key.trim().to_string(),
    };
    if keys.access_key.is_empty() || keys.secret_key.is_empty() {
        return Err("Access Key와 Secret Key를 모두 입력하세요.".to_string());
    }

    // 잔고 조회로 키 유효성을 먼저 검증 — 잘못된 키는 저장하지 않는다
    let accounts = fetch_accounts(&keys).await?;

    let mut store = load_profile_store()?;
    let now = now_ms();
    let selected_profile_id =
        if let Some(profile) = store.profiles.iter_mut().find(|profile| profile.nickname == nickname)
        {
            profile.access_key = keys.access_key.clone();
            profile.secret_key = keys.secret_key.clone();
            profile.updated_at = now;
            profile.id.clone()
        } else {
            let profile = ApiKeyProfile {
                id: Uuid::new_v4().to_string(),
                nickname,
                access_key: keys.access_key.clone(),
                secret_key: keys.secret_key.clone(),
                created_at: now,
                updated_at: now,
            };
            let id = profile.id.clone();
            store.profiles.push(profile);
            id
        };

    store.version = 2;
    store.selected_profile_id = Some(selected_profile_id);
    save_profile_store(&store)?;

    let mut guard = session_keys
        .lock()
        .map_err(|_| "API Key 상태를 사용할 수 없습니다.".to_string())?;
    *guard = Some(keys);

    Ok(accounts)
}

#[tauri::command]
async fn save_api_keys(
    access_key: String,
    secret_key: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    save_profile_and_connect(
        default_profile_nickname(),
        access_key,
        secret_key,
        session_keys,
    )
    .await
}

#[tauri::command]
async fn save_api_key_profile(
    nickname: String,
    access_key: String,
    secret_key: String,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    save_profile_and_connect(nickname, access_key, secret_key, session_keys).await
}

#[tauri::command]
async fn connect_api_key_profile(
    profile_id: Option<String>,
    session_keys: tauri::State<'_, SessionApiKeys>,
) -> Result<Value, String> {
    let mut store = load_profile_store()?;
    let selected_id = profile_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .or_else(|| store.selected_profile_id.clone());

    let profile = selected_id
        .as_ref()
        .and_then(|id| store.profiles.iter().find(|profile| &profile.id == id))
        .or_else(|| store.profiles.first())
        .cloned()
        .ok_or_else(|| "저장된 API Key 프로필이 없습니다. 새 프로필을 입력하세요.".to_string())?;

    let keys = ApiKeys {
        access_key: profile.access_key.clone(),
        secret_key: profile.secret_key.clone(),
    };
    let accounts = fetch_accounts(&keys).await?;

    store.selected_profile_id = Some(profile.id);
    save_profile_store(&store)?;

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
    connect_api_key_profile(None, session_keys).await
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
        .manage(BackgroundTradingTaskState(Mutex::new(None::<JoinHandle<()>>)))
        .manage(Mutex::new(None::<JoinHandle<()>>))
        .manage(KeepAwakeState(Mutex::new(None::<Child>)))
        .manage(OrderbookStreamState(Mutex::new(None::<JoinHandle<()>>)))
        .manage(BoardTradeStreamState(Mutex::new(None::<JoinHandle<()>>)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_ticker,
            get_quote_tickers,
            get_markets,
            get_candles,
            get_trades,
            start_trade_volume_stream,
            stop_trade_volume_stream,
            start_orderbook_stream,
            stop_orderbook_stream,
            start_board_trade_stream,
            stop_board_trade_stream,
            set_background_trading_active,
            has_saved_keys,
            list_api_key_profiles,
            log_bot_trade,
            log_market_snapshot,
            save_api_keys,
            save_api_key_profile,
            connect_api_key_profile,
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

    #[cfg(target_os = "macos")]
    #[test]
    fn keep_awake_process_stays_alive_until_stopped() {
        let mut child = start_keep_awake();
        assert!(child.is_some(), "caffeinate process should start");
        assert!(
            child
                .as_mut()
                .expect("caffeinate child")
                .try_wait()
                .expect("caffeinate status")
                .is_none(),
            "caffeinate process should remain active while the app is running"
        );

        stop_keep_awake(&mut child);
        assert!(child.is_none());
    }
}
