//! Team Agent composer persistence (GeekClaw #72) plus the #73 consensus
//! engine, mounted under the instance-owner guard.

mod persona_defs;
pub mod consensus;
pub mod routes;
pub mod service;
pub mod state;

pub use consensus::{into_app_error as consensus_into_app_error, ConsensusServiceError, TeamConsensusService};
pub use routes::team_routes;
pub use service::{into_app_error, TeamService};
pub use state::TeamRouterState;
