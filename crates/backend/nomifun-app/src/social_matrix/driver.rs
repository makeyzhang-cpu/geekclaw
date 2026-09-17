/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 海外社媒矩阵 —— 发布驱动抽象层。
//!
//! ## 为什么要有这一层
//!
//! 各平台官方 API 都要求申请企业开发者应用并过审（Meta App Review 数周、
//! LinkedIn MDP 需录屏审核、TikTok 未过审只能发私密），这是硬门槛，换任何
//! 开源项目都省不掉。**聚合 API 之所以能绕过它，不是因为技术更聪明，而是
//! 因为服务商已经替所有客户走完了那些审核**。
//!
//! 所以驱动做成三实现同一 trait，业务逻辑只依赖 trait：
//!
//! | 驱动 | 资质要求 | 何时用 |
//! |---|---|---|
//! | [`AggregatorDriver`] | 无（服务商已持过审应用） | 首期默认，当天可真实发帖 |
//! | [`DirectDriver`] | 需自家企业资质 | 资质批下来后配置级切换 |
//! | [`ManualDriver`] | 无、零成本 | 不想连任何第三方时的半自动兜底 |
//!
//! 切换驱动**不改任何业务代码**，也不改桌面 UI —— 桌面只认
//! `/api/store/social/*` 的响应形状。
//!
//! ## 平台密钥缺失是一等状态
//!
//! 某个平台还没配置时，[`PublishDriver::configured_platforms`] 如实返回而已，
//! 界面显示「待接入」。只有真正尝试投递未配置的平台才会返回
//! [`SocialError::PlatformNotConfigured`]。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

/// 引擎**认识**的全部平台（与前端 `platforms.ts` 的 `SocialPlatform` 一一对应）。
///
/// 「认识」不等于「现在能投」—— 后者见 [`LAUNCH_PLATFORMS`]。
pub const PLATFORMS: [&str; 6] = ["linkedin", "facebook", "instagram", "youtube", "x", "tiktok"];

/// 首期真正投放的平台：**刻意不含 `x`**。
///
/// X 的写接口改为按次计费（含链接的帖子单价大幅上调），对 B2B 出海不划算，
/// 因此首期不把它列入可投递集合。引擎仍认识 `x`（见 [`PLATFORMS`]）——
/// 已投递过的历史内容、以及将来的按需开启都不会因此报错，
/// 但它**不会**被上报成「已具备投递能力」，以免界面把它当成当下可用的目标。
pub const LAUNCH_PLATFORMS: [&str; 5] =
    ["linkedin", "facebook", "instagram", "youtube", "tiktok"];

/// 判断一个平台标识是否属于本引擎支持的集合。
pub fn is_supported_platform(platform: &str) -> bool {
    PLATFORMS.contains(&platform)
}

/// 该平台是否属于首期投放范围（见 [`LAUNCH_PLATFORMS`]）。
pub fn is_launch_platform(platform: &str) -> bool {
    LAUNCH_PLATFORMS.contains(&platform)
}

/// 聚合商侧的 `targetType` 与我们的内部平台 id 基本同名，只有 X 需要改名
/// （各家一律用 `twitter`，没有例外）。
pub fn vendor_platform_id(platform: &str) -> &str {
    match platform {
        "x" => "twitter",
        other => other,
    }
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SocialError {
    /// 该平台尚未配置凭据 —— 这不是异常，是待接入状态。
    #[error("平台尚未接入：{0}")]
    PlatformNotConfigured(String),
    /// 整个驱动还没配置（没填 API key / 没选 vendor）。
    #[error("发布驱动未配置：{0}")]
    DriverNotConfigured(String),
    /// 聚合商接口返回了业务错误。
    #[error("聚合接口错误：{0}")]
    Vendor(String),
    #[error("网络请求失败：{0}")]
    Network(String),
    #[error("响应解析失败：{0}")]
    Parse(String),
    #[error("缺少必要参数：{0}")]
    MissingParam(String),
    /// 触发服务商限流 / 配额耗尽 —— **可重试**，不是失败。
    ///
    /// 与 [`SocialError::Vendor`] 的区别在于「等一会儿再来就能成功」：
    /// 上层据此把内容留在队列里退避重试，而不是给用户报一条假失败。
    #[error("触发服务商限流：{0}")]
    RateLimited(String),
}

impl SocialError {
    /// 是否属于「等一会儿重试就可能成功」的临时故障。
    ///
    /// 只有限流与网络抖动算 —— 凭据无效、参数缺失、平台未接入这些，
    /// 重试一万次也是同样结果，必须立刻如实上报而不是无限排队。
    pub fn is_retryable(&self) -> bool {
        matches!(self, SocialError::RateLimited(_) | SocialError::Network(_))
    }
}

pub type SocialResult<T> = Result<T, SocialError>;

/// 判定本次响应是否为「服务商限流」。
///
/// 聚合商在超限时表现不一致：有的给 HTTP 429，有的给成功码但 body 里带
/// 错误文案。两种都认 —— 把「等一会儿就好」误判成「发不出去」，会让用户
/// 看到一条假失败并手动重发，那才是真的重复投递到平台上。
fn is_rate_limited(status: reqwest::StatusCode, body: &Value) -> bool {
    if status.as_u16() == 429 {
        return true;
    }
    let text = body
        .get("errorMessage")
        .or_else(|| body.get("error"))
        .or_else(|| body.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    const MARKERS: [&str; 6] = [
        "rate limit",
        "rate-limit",
        "ratelimit",
        "too many requests",
        "quota exceeded",
        "throttl",
    ];
    MARKERS.iter().any(|k| text.contains(k))
}

// ---------------------------------------------------------------------------
// 驱动无关的数据结构
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriverKind {
    /// 聚合 API（服务商持有全部平台过审应用）。
    Aggregator,
    /// 官方 API 直连。
    Direct,
    /// 半自动：只产出待发内容，不代为发布。
    Manual,
}

/// 聚合商侧的一个已授权账号。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedAccount {
    /// 聚合商侧的账号 id（发布时必须回传）。
    pub provider_account_id: String,
    pub platform: String,
    pub handle: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Facebook / LinkedIn 的「主页」子账号。个人号不能经 API 发帖，
    /// 必须落到主页上，所以这一层是必需的，不是可选优化。
    pub subaccounts: Vec<LinkedSubaccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedSubaccount {
    pub id: String,
    pub name: String,
}

/// 一次投递任务。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishRequest {
    /// 主文案。具体平台若在 `targets[].text` 里有改写版本，以改写版为准。
    pub text: String,
    pub media_urls: Vec<String>,
    pub targets: Vec<PublishTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishTarget {
    /// 本地 `social_accounts.account_id`（回填结果时用）。
    pub account_id: String,
    pub platform: String,
    /// 聚合商侧账号 id。
    pub provider_handle: String,
    /// Facebook / LinkedIn 主页 id（有子账号时必填）。
    pub parent_handle: Option<String>,
    /// 该平台的差异化文案（Mixpost 的 PostVersion 思路）。
    pub text: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeStatus {
    Success,
    Failed,
    Skipped,
    /// 服务商限流 / 网络抖动 —— **可稍后重试**，不记为失败。
    ///
    /// 与 `Failed` 的区别对整条链路都有意义：`Failed` 会出现在
    /// 「为什么没发出去」的失败清单里，`Queued` 只是「还没轮到」。
    Queued,
}

/// 单个目标的投递结果。
///
/// **一条内容投 5 个平台允许 3 成 2 败**：失败只影响自己那一行，不整条回滚，
/// 失败原因各自留存（Mixpost `post_accounts` 的建模）。所以 `publish` 返回
/// 的是「每个目标一条结果」，而不是一个整体的 Ok/Err。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetOutcome {
    pub account_id: String,
    pub status: OutcomeStatus,
    /// 平台侧返回的帖子 id（不透明句柄，原样存）。
    pub provider_post_id: Option<String>,
    pub permalink: Option<String>,
    pub error: Option<String>,
}

impl TargetOutcome {
    pub fn success(account_id: impl Into<String>, provider_post_id: Option<String>, permalink: Option<String>) -> Self {
        Self {
            account_id: account_id.into(),
            status: OutcomeStatus::Success,
            provider_post_id,
            permalink,
            error: None,
        }
    }

    pub fn failed(account_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            status: OutcomeStatus::Failed,
            provider_post_id: None,
            permalink: None,
            error: Some(error.into()),
        }
    }

    /// 排队稍后重试（限流 / 网络抖动）—— 既不算成功，也不算失败。
    ///
    /// `error` 里存的是**排队原因**（不是失败原因），用户看到的措辞是
    /// 「已排队稍后重试」而不是「发布失败」。
    pub fn queued(account_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            status: OutcomeStatus::Queued,
            provider_post_id: None,
            permalink: None,
            error: Some(reason.into()),
        }
    }
}

/// 指标回收的目标。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricTarget {
    pub account_id: String,
    pub platform: String,
    pub provider_post_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MetricSample {
    pub account_id: String,
    pub provider_post_id: String,
    pub impressions: Option<i64>,
    pub likes: Option<i64>,
    pub comments: Option<i64>,
    pub shares: Option<i64>,
    pub views: Option<i64>,
    pub saves: Option<i64>,
    pub clicks: Option<i64>,
}

/// 授权入口。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkInfo {
    /// 可直接打开的系统浏览器地址；`None` 表示去聚合商后台手动连接。
    pub url: Option<String>,
    /// 给用户看的引导文案（聚合商模式下必须说明「去后台连接」）。
    pub hint: String,
}

// ---------------------------------------------------------------------------
// trait：三驱动同一接口
// ---------------------------------------------------------------------------

#[async_trait]
pub trait PublishDriver: Send + Sync {
    fn kind(&self) -> DriverKind;

    /// 聚合商 id（`blotato` / `ayrshare` …）；官方直连与半自动为 `None`。
    fn vendor(&self) -> Option<&'static str>;

    /// 驱动是否已具备工作条件（密钥已填 / 半自动恒为 true）。
    fn is_ready(&self) -> bool;

    /// 已经配置好、可以真实投递的平台。未列出的在界面上显示「待接入」。
    fn configured_platforms(&self) -> Vec<String>;

    /// 取授权入口。
    async fn link_url(&self, platform: &str) -> SocialResult<LinkInfo>;

    /// 拉取该凭据下的全部已授权账号。
    async fn list_accounts(&self) -> SocialResult<Vec<LinkedAccount>>;

    /// 投递。**返回每个目标各自的结果**，部分失败不视为整体失败。
    ///
    /// 只有「凭据无效 / 驱动未配置」这类整体性故障才返回 `Err`。
    async fn publish(&self, req: &PublishRequest) -> SocialResult<Vec<TargetOutcome>>;

    /// 回收指标。单个目标失败时跳过该目标，不影响其余。
    async fn fetch_metrics(&self, targets: &[MetricTarget]) -> SocialResult<Vec<MetricSample>>;
}

// ---------------------------------------------------------------------------
// 聚合商预置表
// ---------------------------------------------------------------------------

/// 聚合商的声明式规格。新增一家只需在 [`VENDORS`] 加一行 ——
/// 业务代码与 UI 都不必改。
///
/// 其中 `media_path` 与 `native_schedule` 当前**刻意不使用**，理由要写清楚：
///   * 媒体：真源是 `social_media.url`，按公网 URL 直投，不走上传给聚合商；
///   * 排期：一律由本机调度器「到点再发」。交给聚合商原生排期只能拿到
///     「已进队列」这类回执，回答不了「到底发出去没有」—— 而逐平台如实上报
///     成败正是这个引擎的核心承诺。
///
/// 留着这两个字段是为了将来真要接这两条路径时，不必再把各家的端点重核一遍。
#[allow(dead_code)]
pub struct VendorSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    /// 鉴权头名与值前缀。Blotato 用裸 key，多数聚合商用 `Bearer`。
    pub auth_header: &'static str,
    pub auth_prefix: &'static str,
    pub accounts_path: &'static str,
    /// 子账号路径，`{account}` 会被替换为账号 id。
    pub subaccounts_path: &'static str,
    pub publish_path: &'static str,
    pub media_path: &'static str,
    /// 是否支持原生 `scheduledTime`（不支持时由本机调度器到点再发）。
    pub native_schedule: bool,
    /// 授权入口（聚合商自有后台）。
    pub console_url: Option<&'static str>,
}

/// 预置聚合商。**默认 [`DEFAULT_VENDOR`]**。
///
/// 各家 API 契约由其官方文档定义，接入前需按文档核对一次字段名 ——
/// 这里记录的是已核实过的形态，未核实的部分以 `console_url` 引导到其后台。
pub const VENDORS: &[VendorSpec] = &[
    // 已核实（2026-09）：端点、鉴权头、发布体形状均来自官方 API 文档。
    VendorSpec {
        id: "blotato",
        label: "Blotato",
        base_url: "https://backend.blotato.com/v2",
        auth_header: "blotato-api-key",
        auth_prefix: "",
        accounts_path: "/users/me/accounts",
        subaccounts_path: "/users/me/accounts/{account}/subaccounts",
        publish_path: "/posts",
        media_path: "/media",
        native_schedule: true,
        console_url: Some("https://my.blotato.com/"),
    },
    VendorSpec {
        id: "ayrshare",
        label: "Ayrshare",
        base_url: "https://api.ayrshare.com/api",
        auth_header: "Authorization",
        auth_prefix: "Bearer ",
        accounts_path: "/profiles",
        subaccounts_path: "",
        publish_path: "/post",
        media_path: "/media/upload",
        native_schedule: true,
        console_url: Some("https://app.ayrshare.com/"),
    },
    VendorSpec {
        id: "post_bridge",
        label: "Post Bridge",
        base_url: "https://api.post-bridge.com/v1",
        auth_header: "Authorization",
        auth_prefix: "Bearer ",
        accounts_path: "/social-accounts",
        subaccounts_path: "",
        publish_path: "/posts",
        media_path: "/media",
        native_schedule: true,
        console_url: Some("https://post-bridge.com/"),
    },
    VendorSpec {
        id: "outstand",
        label: "Outstand",
        base_url: "https://api.outstand.so/v1",
        auth_header: "Authorization",
        auth_prefix: "Bearer ",
        accounts_path: "/accounts",
        subaccounts_path: "",
        publish_path: "/posts",
        media_path: "/media",
        native_schedule: true,
        console_url: Some("https://app.outstand.so/"),
    },
];

/// 默认聚合商。
pub const DEFAULT_VENDOR: &str = "blotato";

pub fn vendor_spec(id: &str) -> Option<&'static VendorSpec> {
    VENDORS.iter().find(|v| v.id == id)
}

// ---------------------------------------------------------------------------
// 实现一：聚合 API
// ---------------------------------------------------------------------------

/// 聚合驱动 —— 首期默认。**不需要任何企业资质**。
///
/// 服务商已持所有平台的过审应用，本机只拿一个密钥。代价是内容经过第三方
/// （见 [`AggregatorDriver::data_flow_note`]），且按订阅计费。
pub struct AggregatorDriver {
    spec: &'static VendorSpec,
    api_key: String,
    http: reqwest::Client,
}

impl AggregatorDriver {
    pub fn new(vendor_id: &str, api_key: impl Into<String>) -> SocialResult<Self> {
        let spec = vendor_spec(vendor_id)
            .ok_or_else(|| SocialError::DriverNotConfigured(format!("未知聚合商：{vendor_id}")))?;
        Ok(Self {
            spec,
            api_key: api_key.into(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(|e| SocialError::Network(e.to_string()))?,
        })
    }

    /// 数据流向说明 —— 上线前应让用户知情：内容会经过聚合商服务器。
    pub fn data_flow_note() -> &'static str {
        "内容与媒体会经聚合服务商转发到各平台，由其代为持有平台授权。"
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.spec.base_url, path)
    }

    fn authed(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .header(
                self.spec.auth_header,
                format!("{}{}", self.spec.auth_prefix, self.api_key),
            )
    }

    /// 按 vendor 的契约构造发布体。
    ///
    /// 差异全部收在这个函数里 —— 换聚合商不动别处。
    fn build_publish_body(&self, req: &PublishRequest, target: &PublishTarget) -> Value {
        let pid = vendor_platform_id(&target.platform);
        let text = target
            .text
            .clone()
            .unwrap_or_else(|| req.text.clone());

        match self.spec.id {
            // Blotato：{ post: { accountId, content{text,mediaUrls,platform}, target{targetType,pageId} } }
            "blotato" => {
                let mut target_obj = json!({ "targetType": pid });
                if let Some(page) = target.parent_handle.as_deref() {
                    if !page.is_empty() {
                        target_obj["pageId"] = json!(page);
                    }
                }
                json!({
                    "post": {
                        "accountId": target.provider_handle,
                        "content": {
                            "text": text,
                            "mediaUrls": req.media_urls,
                            "platform": pid,
                        },
                        "target": target_obj,
                    }
                })
            }
            // Ayrshare / Outstand / Post Bridge 等：post 数组 + platforms 数组的扁平形态。
            _ => {
                let mut platform_obj = json!({ "platform": pid });
                if let Some(page) = target.parent_handle.as_deref() {
                    if !page.is_empty() {
                        platform_obj["pageId"] = json!(page);
                    }
                }
                json!({
                    "post": text,
                    "mediaUrls": req.media_urls,
                    "platforms": [pid],
                    "accountId": target.provider_handle,
                    "platformOptions": platform_obj,
                })
            }
        }
    }

    /// 从各家形态各异的响应里取出帖子 id 与永久链接。
    fn parse_publish_response(&self, body: &Value) -> (Option<String>, Option<String>, Option<String>) {
        let get = |keys: &[&str]| -> Option<String> {
            for k in keys {
                if let Some(v) = body.get(*k) {
                    if let Some(s) = v.as_str() {
                        if !s.is_empty() {
                            return Some(s.to_string());
                        }
                    }
                    if let Some(n) = v.as_i64() {
                        return Some(n.to_string());
                    }
                }
            }
            None
        };
        let id = get(&["postSubmissionId", "postId", "id", "post_id"]);
        let url = get(&["publicUrl", "permalink", "url", "postUrl", "post_url"]);
        let err = get(&["errorMessage", "error", "message"]);
        (id, url, err)
    }

    /// 为目标平台补齐「主页 / 组织」子账号。
    ///
    /// Facebook / LinkedIn 的**个人号不能经 API 发帖**，必须落到主页或组织上，
    /// 而发布体的 `pageId` 只能从这一层拿。少了这一步，账号能列出来、但一发就
    /// 失败 —— 所以这不是可选优化。
    ///
    /// 单个账号拉子账号失败只跳过该账号（保留它自己的 profile 身份），不整批报错。
    async fn fill_subaccounts(&self, accounts: &mut [LinkedAccount]) {
        if self.spec.subaccounts_path.is_empty() {
            return;
        }
        for acc in accounts.iter_mut() {
            // 只有「必须落到主页」的平台需要这一层；IG / YouTube / TikTok 直接投账号。
            if !matches!(acc.platform.as_str(), "facebook" | "linkedin") {
                continue;
            }
            let path = self
                .spec
                .subaccounts_path
                .replace("{account}", &acc.provider_account_id);
            let url = self.endpoint(&path);
            let Ok(resp) = self.authed(reqwest::Method::GET, &url).send().await else {
                continue;
            };
            let Ok(body) = resp.json::<Value>().await else {
                continue;
            };
            let items = body
                .get("items")
                .or_else(|| body.get("subaccounts"))
                .or_else(|| body.get("data"))
                .cloned()
                .unwrap_or(body.clone());
            for it in items.as_array().cloned().unwrap_or_default() {
                let Some(id) = it
                    .get("id")
                    .or_else(|| it.get("pageId"))
                    .or_else(|| it.get("accountId"))
                    .map(|v| {
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string())
                    })
                else {
                    continue;
                };
                let name = it
                    .get("name")
                    .or_else(|| it.get("fullname"))
                    .or_else(|| it.get("username"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&id)
                    .to_string();
                acc.subaccounts.push(LinkedSubaccount { id, name });
            }
        }
    }
}

#[async_trait]
impl PublishDriver for AggregatorDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Aggregator
    }

    fn vendor(&self) -> Option<&'static str> {
        Some(self.spec.id)
    }

    fn is_ready(&self) -> bool {
        !self.api_key.trim().is_empty()
    }

    /// 聚合商模式下，可用平台 = 首期投放集合（[`LAUNCH_PLATFORMS`]，**不含 X**）。
    ///
    /// 聚合商在技术上通常也能代发 X，但那是按次计费的商业决策问题，
    /// 不是能力问题 —— 所以这里以产品边界为准，而不是以 vendor 的能力为准。
    ///
    /// 真实「已连接了哪几个」由 [`Self::list_accounts`] 决定 ——
    /// 这里回答的是「本驱动有能力投递哪些」。
    fn configured_platforms(&self) -> Vec<String> {
        if !self.is_ready() {
            return Vec::new();
        }
        LAUNCH_PLATFORMS.iter().map(|p| p.to_string()).collect()
    }

    async fn link_url(&self, platform: &str) -> SocialResult<LinkInfo> {
        if !is_supported_platform(platform) {
            return Err(SocialError::PlatformNotConfigured(platform.to_string()));
        }
        if !self.is_ready() {
            return Err(SocialError::DriverNotConfigured("未填写聚合服务 API Key".into()));
        }
        // 聚合商模式下授权在**服务商自己的后台**完成：用户在那边连接各平台账号，
        // 我们这边只负责读回账号列表。所以这里给的是引导而非 OAuth 链接。
        Ok(LinkInfo {
            url: self.spec.console_url.map(|u| u.to_string()),
            hint: format!(
                "请在 {} 后台连接 {} 账号，连接完成后回到本页点「刷新账号」。",
                self.spec.label,
                platform
            ),
        })
    }

    async fn list_accounts(&self) -> SocialResult<Vec<LinkedAccount>> {
        if !self.is_ready() {
            return Err(SocialError::DriverNotConfigured("未填写聚合服务 API Key".into()));
        }
        let url = self.endpoint(self.spec.accounts_path);
        let resp = self
            .authed(reqwest::Method::GET, &url)
            .send()
            .await
            .map_err(|e| SocialError::Network(e.to_string()))?;

        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| SocialError::Parse(format!("账号列表响应不是合法 JSON：{e}")))?;

        if !status.is_success() {
            return Err(SocialError::Vendor(format!(
                "{} 返回 {status}：{}",
                self.spec.label,
                body.get("message")
                    .or_else(|| body.get("error"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
            )));
        }

        // 响应形状：{items:[...]} 或裸数组。
        let items = body
            .get("items")
            .or_else(|| body.get("accounts"))
            .or_else(|| body.get("data"))
            .cloned()
            .unwrap_or(body.clone());
        let arr = items.as_array().cloned().unwrap_or_default();

        let mut out = Vec::new();
        for it in arr {
            let Some(id) = it
                .get("id")
                .or_else(|| it.get("accountId"))
                .or_else(|| it.get("account_id"))
                .map(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| v.to_string())
                })
            else {
                continue;
            };
            let platform = it
                .get("platform")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // 聚合商可能返回我们不支持的平台，静默跳过而不是报错。
            if !is_supported_platform(&platform) {
                continue;
            }
            out.push(LinkedAccount {
                provider_account_id: id,
                platform,
                handle: it
                    .get("username")
                    .or_else(|| it.get("handle"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                display_name: it
                    .get("fullname")
                    .or_else(|| it.get("name"))
                    .or_else(|| it.get("displayName"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                avatar_url: it
                    .get("profileImageUrl")
                    .or_else(|| it.get("avatarUrl"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                subaccounts: Vec::new(),
            });
        }
        self.fill_subaccounts(&mut out).await;
        Ok(out)
    }

    async fn publish(&self, req: &PublishRequest) -> SocialResult<Vec<TargetOutcome>> {
        if !self.is_ready() {
            return Err(SocialError::DriverNotConfigured("未填写聚合服务 API Key".into()));
        }

        let url = self.endpoint(self.spec.publish_path);
        let mut outcomes = Vec::with_capacity(req.targets.len());

        // 逐目标串行投递：聚合商普遍按次限流，并发反而更容易触发 429。
        for target in &req.targets {
            let body = self.build_publish_body(req, target);
            let resp = self
                .authed(reqwest::Method::POST, &url)
                .json(&body)
                .send()
                .await;

            match resp {
                Ok(r) => {
                    let status = r.status();
                    let parsed: Value = r.json().await.unwrap_or(Value::Null);

                    // 限流**优先**判定：限流响应里通常也带 `message`，
                    // 若先走 `parse_publish_response` 会把它当成业务错误，
                    // 于是「等一会儿就能发」被记成永久失败。
                    if is_rate_limited(status, &parsed) {
                        outcomes.push(TargetOutcome::queued(
                            target.account_id.clone(),
                            format!(
                                "{} 限流（HTTP {}），已排队稍后重试",
                                self.spec.label,
                                status.as_u16()
                            ),
                        ));
                        continue;
                    }

                    let (id, permalink, err) = self.parse_publish_response(&parsed);
                    if status.is_success() && err.is_none() {
                        outcomes.push(TargetOutcome::success(
                            target.account_id.clone(),
                            id,
                            permalink,
                        ));
                    } else {
                        // 单平台失败只记这一行 —— 不让它拖垮其余平台。
                        outcomes.push(TargetOutcome::failed(
                            target.account_id.clone(),
                            err.unwrap_or_else(|| format!("{} 返回 {status}", self.spec.label)),
                        ));
                    }
                }
                // 网络抖动（超时 / 连接重置）同样排队重试 —— 发不出去不等于
                // 永久失败。真正的配置类故障在 `is_ready()` 与 HTTP 4xx 上暴露。
                Err(e) => outcomes.push(TargetOutcome::queued(
                    target.account_id.clone(),
                    format!("网络请求异常，已排队稍后重试：{e}"),
                )),
            }
        }
        Ok(outcomes)
    }

    async fn fetch_metrics(&self, _targets: &[MetricTarget]) -> SocialResult<Vec<MetricSample>> {
        // 聚合商的指标端点各家用不同的路径与字段名，且多数要求按帖逐个拉取。
        // 首期先返回空集（界面据「无采样」如实显示），待确定 vendor 后按
        // 其文档补 `/analytics` 映射 —— 不在这里编造端点。
        Ok(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// 实现二：官方 API 直连（占位，等企业资质）
// ---------------------------------------------------------------------------

/// 官方 API 直连驱动。
///
/// **当前为结构占位**：自家企业应用尚未过审，因此 [`Self::configured_platforms`]
/// 恒为空，界面如实显示「待接入」。等资质批下来后，在 [`Self::publish`] 里
/// 按平台补真实调用即可 —— 上层与 UI 无需任何改动。
pub struct DirectDriver {
    /// 已完成过审的平台（逐个开放）。
    enabled: Vec<String>,
}

impl DirectDriver {
    pub fn new(enabled: Vec<String>) -> Self {
        Self { enabled }
    }
}

#[async_trait]
impl PublishDriver for DirectDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Direct
    }

    fn vendor(&self) -> Option<&'static str> {
        None
    }

    fn is_ready(&self) -> bool {
        !self.enabled.is_empty()
    }

    fn configured_platforms(&self) -> Vec<String> {
        self.enabled.clone()
    }

    async fn link_url(&self, platform: &str) -> SocialResult<LinkInfo> {
        if !self.enabled.iter().any(|p| p == platform) {
            return Err(SocialError::PlatformNotConfigured(platform.to_string()));
        }
        Err(SocialError::DriverNotConfigured(
            "官方 API 驱动尚未实现（需先取得该平台的企业开发者资质）".into(),
        ))
    }

    async fn list_accounts(&self) -> SocialResult<Vec<LinkedAccount>> {
        Err(SocialError::DriverNotConfigured(
            "官方 API 驱动尚未实现（需先取得该平台的企业开发者资质）".into(),
        ))
    }

    async fn publish(&self, req: &PublishRequest) -> SocialResult<Vec<TargetOutcome>> {
        Ok(req
            .targets
            .iter()
            .map(|t| {
                TargetOutcome::failed(
                    t.account_id.clone(),
                    "官方 API 驱动尚未启用：请先在「平台接入」里切换到聚合驱动",
                )
            })
            .collect())
    }

    async fn fetch_metrics(&self, _targets: &[MetricTarget]) -> SocialResult<Vec<MetricSample>> {
        Ok(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// 实现三：半自动
// ---------------------------------------------------------------------------

/// 半自动驱动 —— 零审核、零成本、零封号风险。
///
/// 「发布」不真的调用任何平台，而是把这条内容标记为「待人工发布」，
/// 用户在界面上看到到点提醒后自行复制粘贴。内容创作、平台差异化改写、
/// 日历排期照常工作，只是最后一步由人完成。
///
/// 对不愿连接第三方服务的客户，这是完全可用的兜底形态。
pub struct ManualDriver;

#[async_trait]
impl PublishDriver for ManualDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Manual
    }

    fn vendor(&self) -> Option<&'static str> {
        None
    }

    /// 半自动模式**不具备真实投递能力** —— 没有任何 API 调用会发生，
    /// 内容会被 `.publish()` 标成 [`OutcomeStatus::Skipped`] 转人工。
    ///
    /// 所以这里如实返回 `false`：`ready` 回答的是「服务端现在能不能真发出去」，
    /// 而不是「这个驱动能不能用」。半自动可见、可选、可兜底，但不算「已接入」。
    fn is_ready(&self) -> bool {
        false
    }

    /// 半自动模式下**不宣告任何「已可投递」平台**。
    ///
    /// 若这里返回全部平台，账号矩阵会把 6 个平台全部显示为「未连接账号 + 连接账号」，
    /// 而连接按钮点下去必然报错 —— 这是把「兜底形态」伪装成「已接入」，属于误导。
    ///
    /// 返回空集后界面如实显示「待接入」，并提示去管理台配置发布通道。
    fn configured_platforms(&self) -> Vec<String> {
        Vec::new()
    }

    async fn link_url(&self, platform: &str) -> SocialResult<LinkInfo> {
        if !is_supported_platform(platform) {
            return Err(SocialError::PlatformNotConfigured(platform.to_string()));
        }
        Ok(LinkInfo {
            url: None,
            hint: "半自动模式无需授权：到点后按提示人工发布即可。".into(),
        })
    }

    async fn list_accounts(&self) -> SocialResult<Vec<LinkedAccount>> {
        // 半自动模式没有真实账号，账号由用户自行登记。
        Ok(Vec::new())
    }

    async fn publish(&self, req: &PublishRequest) -> SocialResult<Vec<TargetOutcome>> {
        Ok(req
            .targets
            .iter()
            .map(|t| TargetOutcome {
                account_id: t.account_id.clone(),
                // `skipped` 而非 `failed`：这不代表出错，而是「转人工」。
                status: OutcomeStatus::Skipped,
                provider_post_id: None,
                permalink: None,
                error: Some("半自动模式：请在【待发布】里复制内容后手动发布".into()),
            })
            .collect())
    }

    async fn fetch_metrics(&self, _targets: &[MetricTarget]) -> SocialResult<Vec<MetricSample>> {
        Ok(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/// 按配置装配驱动。这是「切换驱动」的唯一入口。
pub fn build_driver(kind: DriverKind, vendor: &str, api_key: &str) -> Box<dyn PublishDriver> {
    match kind {
        DriverKind::Aggregator => match AggregatorDriver::new(vendor, api_key) {
            Ok(d) => Box::new(d),
            // 未知 vendor 名（配置脏数据）时退回默认，而不是让服务起不来。
            Err(_) => match AggregatorDriver::new(DEFAULT_VENDOR, api_key) {
                Ok(d) => Box::new(d),
                Err(_) => Box::new(ManualDriver),
            },
        },
        DriverKind::Direct => Box::new(DirectDriver::new(Vec::new())),
        DriverKind::Manual => Box::new(ManualDriver),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x_maps_to_twitter_everywhere() {
        assert_eq!(vendor_platform_id("x"), "twitter");
        assert_eq!(vendor_platform_id("linkedin"), "linkedin");
    }

    #[test]
    fn unknown_vendor_falls_back_to_default() {
        let d = build_driver(DriverKind::Aggregator, "no-such-vendor", "key");
        assert_eq!(d.vendor(), Some(DEFAULT_VENDOR));
    }

    #[test]
    fn aggregator_without_key_reports_nothing_configured() {
        let d = AggregatorDriver::new(DEFAULT_VENDOR, "").unwrap();
        assert!(!d.is_ready());
        assert!(d.configured_platforms().is_empty());
    }

    #[test]
    fn aggregator_ready_lists_launch_platforms_without_x() {
        let d = AggregatorDriver::new(DEFAULT_VENDOR, "k").unwrap();
        assert!(d.is_ready());
        let got = d.configured_platforms();
        assert_eq!(got.len(), LAUNCH_PLATFORMS.len(), "应恰好等于首期平台数：{got:?}");
        // X 写接口按次计费，首期刻意不投放 —— 不能因为聚合商「能发」就报成可用。
        assert!(!got.iter().any(|p| p == "x"), "首期刻意不含 X：{got:?}");
        for p in LAUNCH_PLATFORMS {
            assert!(got.iter().any(|g| g == p), "缺少首期平台 {p}");
        }
        // 引擎侧还会再按 `is_supported_platform` 过滤一次，确保过滤不会误杀。
        assert!(got.iter().all(|p| is_supported_platform(p)));
    }

    #[test]
    fn manual_mode_advertises_no_deliverable_platform() {
        let d = ManualDriver;
        assert!(!d.is_ready(), "半自动不具备真实投递能力，不该自称 ready");
        assert!(
            d.configured_platforms().is_empty(),
            "半自动不该宣告任何「已接入」平台，否则界面会显示成可连接"
        );
    }

    #[tokio::test]
    async fn manual_driver_skips_rather_than_fails() {
        let d = ManualDriver;
        let req = PublishRequest {
            text: "hi".into(),
            media_urls: vec![],
            targets: vec![PublishTarget {
                account_id: "a1".into(),
                platform: "linkedin".into(),
                provider_handle: "x".into(),
                parent_handle: None,
                text: None,
            }],
        };
        let out = d.publish(&req).await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].status, OutcomeStatus::Skipped);
    }

    #[test]
    fn blotato_body_carries_page_id_for_pages() {
        let d = AggregatorDriver::new("blotato", "k").unwrap();
        let req = PublishRequest {
            text: "main".into(),
            media_urls: vec!["https://cdn/x.jpg".into()],
            targets: vec![],
        };
        let t = PublishTarget {
            account_id: "a1".into(),
            platform: "facebook".into(),
            provider_handle: "98432".into(),
            parent_handle: Some("page-777".into()),
            text: Some("fb 版本文案".into()),
        };
        let body = d.build_publish_body(&req, &t);
        assert_eq!(body["post"]["accountId"], "98432");
        assert_eq!(body["post"]["content"]["platform"], "facebook");
        // 平台差异化文案优先于主文案。
        assert_eq!(body["post"]["content"]["text"], "fb 版本文案");
        // 主页 id 必须带上 —— FB 个人号不能经 API 发帖。
        assert_eq!(body["post"]["target"]["pageId"], "page-777");
    }
}
