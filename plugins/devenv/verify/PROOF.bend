import Base
import ./LAWS.bend as Laws
import ./model.bend as M

def Laws.prepared_host_launch_reports_detected(profile):
  {==}

def Laws.prepared_applied_launch_reports_ready(profile):
  {==}

def Laws.budget_elapsed_runs_on_host(application):
  {==}

def Laws.prepared_does_not_apply(application):
  {==}

def Laws.changed_does_not_apply(application):
  {==}

def Laws.revoked_does_not_rewrite_running_session(application):
  {==}

def Laws.opening_with_profile_applies(application, profile):
  {==}

def Laws.opening_without_profile_runs_on_host(application):
  {==}

def Laws.host_is_not_applied():
  {==}

def Laws.applied_is_applied(profile):
  {==}

def Laws.prepared_host_requires_reload(profile, fresh):
  {==}

def Laws.current_applied_needs_no_reload(profile):
  {==}

def Laws.changed_applied_requires_reload(load, profile):
  match load:
    case M.Unloaded{}:
      {==}
    case M.InFlight{}:
      {==}
    case M.Loaded{other}:
      {==}
    case M.Failed{}:
      {==}

def Laws.revoked_applied_requires_reload(profile, fresh):
  {==}

def Laws.untrusted_starts_no_build(event):
  {==}

def Laws.inflight_starts_no_second_build(event):
  {==}

def Laws.trust_read_starts_no_build(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.command_starts_no_build(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.untrusted_never_injects(event):
  {==}

def Laws.untrusted_never_loads():
  {==}

def Laws.inflight_never_injects(event):
  {==}

def Laws.unloaded_never_injects(event):
  {==}

def Laws.failed_never_injects(event):
  {==}

def Laws.command_never_transitions(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.untrusted_reports_denied():
  {==}

def Laws.unloaded_reports_detected():
  {==}

def Laws.inflight_reports_loading():
  {==}

def Laws.loaded_reports_ready():
  {==}

def Laws.failed_reports_error():
  {==}

def Laws.published_denied():
  {==}

def Laws.published_detected():
  {==}

def Laws.published_loading():
  {==}

def Laws.published_ready():
  {==}

def Laws.published_error():
  {==}

def Laws.trust_observed_lands_unloaded():
  {==}

def Laws.unloaded_loads_on_session_open():
  {==}

def Laws.unloaded_loads_on_allow_request():
  {==}

def Laws.revoke_untrusts(load):
  match load:
    case M.Unloaded{}:
      {==}
    case M.InFlight{}:
      {==}
    case M.Loaded{profile}:
      {==}
    case M.Failed{}:
      {==}

def Laws.load_ok_records_profile(profile):
  {==}

def Laws.project_change_forces_reload(profile):
  {==}

def Laws.cooldown_retries():
  {==}

def Laws.project_change_stops_injection(profile):
  {==}

def Laws.command_injects_iff_loaded(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.session_open_row(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.only_ready_injects(state):
  match state:
    case M.Untrusted{}:
      {==}
    case M.Trusted{load}:
      match load:
        case M.Unloaded{}:
          {==}
        case M.InFlight{}:
          {==}
        case M.Loaded{profile}:
          {==}
        case M.Failed{}:
          {==}

def Laws.untrusted_rejects_load_ok(profile):
  {==}

def Laws.unloaded_rejects_load_ok(profile):
  {==}

def Laws.loaded_rejects_load_ok(profile):
  {==}

def Laws.failed_rejects_load_ok(profile):
  {==}

def Laws.untrusted_loads_only_on_trust_grant(event):
  match event:
    case M.EvSessionOpen{}:
      {==}
    case M.EvTrustObserved{}:
      {==}
    case M.EvAllowRequested{}:
      {==}
    case M.EvRevoke{}:
      {==}
    case M.EvCommand{}:
      {==}
    case M.EvLoadOk{_}:
      {==}
    case M.EvLoadFail{}:
      {==}
    case M.EvCooldownElapsed{}:
      {==}
    case M.EvProjectChanged{}:
      {==}

def Laws.unloaded_loads_only_on_session_open(event):
  match event:
    case M.EvSessionOpen{}:
      {==}
    case M.EvTrustObserved{}:
      {==}
    case M.EvAllowRequested{}:
      {==}
    case M.EvRevoke{}:
      {==}
    case M.EvCommand{}:
      {==}
    case M.EvLoadOk{_}:
      {==}
    case M.EvLoadFail{}:
      {==}
    case M.EvCooldownElapsed{}:
      {==}
    case M.EvProjectChanged{}:
      {==}

def Laws.inflight_loads_only_on_load_result(event):
  match event:
    case M.EvSessionOpen{}:
      {==}
    case M.EvTrustObserved{}:
      {==}
    case M.EvAllowRequested{}:
      {==}
    case M.EvRevoke{}:
      {==}
    case M.EvCommand{}:
      {==}
    case M.EvLoadOk{profile}:
      {==}
    case M.EvLoadFail{}:
      {==}
    case M.EvCooldownElapsed{}:
      {==}
    case M.EvProjectChanged{}:
      {==}

def Laws.loaded_loads_only_on_project_change(profile, event):
  match event:
    case M.EvSessionOpen{}:
      {==}
    case M.EvTrustObserved{}:
      {==}
    case M.EvAllowRequested{}:
      {==}
    case M.EvRevoke{}:
      {==}
    case M.EvCommand{}:
      {==}
    case M.EvLoadOk{_}:
      {==}
    case M.EvLoadFail{}:
      {==}
    case M.EvCooldownElapsed{}:
      {==}
    case M.EvProjectChanged{}:
      {==}

def Laws.failed_loads_only_on_cooldown(event):
  match event:
    case M.EvSessionOpen{}:
      {==}
    case M.EvTrustObserved{}:
      {==}
    case M.EvAllowRequested{}:
      {==}
    case M.EvRevoke{}:
      {==}
    case M.EvCommand{}:
      {==}
    case M.EvLoadOk{_}:
      {==}
    case M.EvLoadFail{}:
      {==}
    case M.EvCooldownElapsed{}:
      {==}
    case M.EvProjectChanged{}:
      {==}
