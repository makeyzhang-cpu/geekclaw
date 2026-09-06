//! 客服独立域 (customer-service domain).
//!
//! A standalone domain for serving strangers over IM channels. It shares NO
//! concepts with the desktop companion/conversation system: dialogues are the
//! domain's own aggregate, replies are produced by a disposable one-shot
//! engine session whose tool registry is fixed at construction time to three
//! read-only tools.

pub mod dialogue;
pub mod model_resolver;
pub mod routes;
pub mod service;
pub mod sla;
pub mod sla_monitor;
pub mod tools;
pub mod widget;

pub use dialogue::{CsDialogueEngine, LiveTurnRunner, TurnRunner};
pub use model_resolver::CsModelResolver;
pub use routes::{
    CsWidgetRouterState, CustomerServiceRouterState, cs_widget_public_routes,
    customer_service_routes,
};
pub use service::{CreateCsAgentInput, CreateCsNoteInput, CustomerServiceService};
pub use sla_monitor::{SlaScanReport, spawn_sla_monitor};
pub use widget::{
    CsWidgetService, WEB_WIDGET_PLUGIN_ID, WidgetBootstrap, WidgetMessage, WidgetReply,
};
