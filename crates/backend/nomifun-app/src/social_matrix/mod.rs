/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 海外社媒矩阵引擎（云端常驻）。
//!
//! 桌面端只做编排与展示，真正的授权、排期、发布、指标回收都在这里 ——
//! **排期帖必须由服务端发出**，用户关掉电脑也要按时投递。
//!
//! 模块划分：
//!   - [`driver`]    发布驱动抽象（聚合 / 官方 / 半自动三实现同一 trait）
//!   - [`engine`]    引擎核心：账号同步 / 投递 / 指标回收（路由与调度器共用）
//!   - [`quota`]     加装包额度口径与闸门（迁移 047）
//!   - [`routes`]    `/api/social/*` 路由
//!   - [`scheduler`] 常驻调度器：轮询到期帖并投递

pub mod driver;
pub mod engine;
pub mod quota;
pub mod routes;
pub mod scheduler;

// 对外只重导出 app 层真正用到的入口（`router/state.rs` 与 `router/routes.rs`）。
// 子模块之间一律走 `super::driver::…` / `super::engine::…`，避免这里堆积
// 一堆无人引用的重导出。
pub use engine::SocialEngine;
pub use routes::{social_matrix_routes, SocialMatrixRouterState};
pub use scheduler::{spawn_social_scheduler, SocialSchedulerConfig};
