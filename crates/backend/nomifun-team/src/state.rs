use std::sync::Arc;

use crate::consensus::TeamConsensusService;
use crate::service::TeamService;

/// Router state for the Team Agent routes (composer CRUD + #73 consensus
/// engine). Cheap to clone (`Arc` internals).
#[derive(Clone)]
pub struct TeamRouterState {
    pub service: Arc<TeamService>,
    pub consensus: Arc<TeamConsensusService>,
}

impl TeamRouterState {
    pub fn new(service: Arc<TeamService>, consensus: Arc<TeamConsensusService>) -> Self {
        Self {
            service,
            consensus,
        }
    }
}
