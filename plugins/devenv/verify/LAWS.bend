import Base
import ./model.bend as M

law untrusted_never_injects:
  for +event: M.RootEvent
  {M.decide(M.Untrusted{}, event) == M.Skip{} : M.Inject}

law untrusted_never_loads:
  {M.step(M.Untrusted{}, M.EvSessionOpen{}) == M.TrRejected{} : M.Transition}

law inflight_never_injects:
  for +event: M.RootEvent
  {M.decide(M.Trusted{M.InFlight{}}, event) == M.Skip{} : M.Inject}

law unloaded_never_injects:
  for +event: M.RootEvent
  {M.decide(M.Trusted{M.Unloaded{}}, event) == M.Skip{} : M.Inject}

law failed_never_injects:
  for +event: M.RootEvent
  {M.decide(M.Trusted{M.Failed{}}, event) == M.Skip{} : M.Inject}

law command_never_transitions:
  for +state: M.RootState
  {M.step(state, M.EvCommand{}) == M.TrRejected{} : M.Transition}

law untrusted_reports_denied:
  {M.status(M.Untrusted{}) == M.Denied{} : M.Status}

law unloaded_reports_detected:
  {M.status(M.Trusted{M.Unloaded{}}) == M.Detected{} : M.Status}

law inflight_reports_loading:
  {M.status(M.Trusted{M.InFlight{}}) == M.Loading{} : M.Status}

law loaded_reports_ready:
  {M.status(M.Trusted{M.Loaded{M.Profile{"/p"}}}) == M.Ready{} : M.Status}

law failed_reports_error:
  {M.status(M.Trusted{M.Failed{}}) == M.Errored{} : M.Status}

law published_denied:
  {M.published(M.Denied{}) == "denied" : String}

law published_detected:
  {M.published(M.Detected{}) == "detected" : String}

law published_loading:
  {M.published(M.Loading{}) == "loading" : String}

law published_ready:
  {M.published(M.Ready{}) == "ready" : String}

law published_error:
  {M.published(M.Errored{}) == "error" : String}

law trust_observed_lands_unloaded:
  {M.step(M.Untrusted{}, M.EvTrustObserved{}) == M.TrAccepted{M.Trusted{M.Unloaded{}}} : M.Transition}

law unloaded_loads_on_session_open:
  {M.step(M.Trusted{M.Unloaded{}}, M.EvSessionOpen{}) == M.TrAccepted{M.Trusted{M.InFlight{}}} : M.Transition}

law unloaded_loads_on_allow_request:
  {M.step(M.Trusted{M.Unloaded{}}, M.EvAllowRequested{}) == M.TrAccepted{M.Trusted{M.InFlight{}}} : M.Transition}

law revoke_untrusts:
  for +load: M.Load
  {M.step(M.Trusted{load}, M.EvRevoke{}) == M.TrAccepted{M.Untrusted{}} : M.Transition}

law load_ok_records_profile:
  for +profile: M.Profile
  {M.step(M.Trusted{M.InFlight{}}, M.EvLoadOk{profile}) == M.TrAccepted{M.Trusted{M.Loaded{profile}}} : M.Transition}

law project_change_forces_reload:
  for +profile: M.Profile
  {M.step(M.Trusted{M.Loaded{profile}}, M.EvProjectChanged{}) == M.TrAccepted{M.Trusted{M.InFlight{}}} : M.Transition}

law cooldown_retries:
  {M.step(M.Trusted{M.Failed{}}, M.EvCooldownElapsed{}) == M.TrAccepted{M.Trusted{M.InFlight{}}} : M.Transition}

law project_change_stops_injection:
  for +profile: M.Profile
  {M.gives(M.decide(M.Trusted{M.Loaded{profile}}, M.EvProjectChanged{})) == False{} : Bool}

law command_injects_iff_loaded:
  for +state: M.RootState
  {M.gives(M.decide(state, M.EvCommand{})) == M.injectable(state) : Bool}

law session_open_row:
  for +state: M.RootState
  {M.step(state, M.EvSessionOpen{}) == M.session_open_spec(state) : M.Transition}

law only_ready_injects:
  for +state: M.RootState
  {M.gives(M.decide(state, M.EvCommand{})) == M.is_ready(M.status(state)) : Bool}

law untrusted_rejects_load_ok:
  for +profile: M.Profile
  {M.step(M.Untrusted{}, M.EvLoadOk{profile}) == M.TrRejected{} : M.Transition}

law unloaded_rejects_load_ok:
  for +profile: M.Profile
  {M.step(M.Trusted{M.Unloaded{}}, M.EvLoadOk{profile}) == M.TrRejected{} : M.Transition}

law loaded_rejects_load_ok:
  for +profile: M.Profile
  {M.step(M.Trusted{M.Loaded{M.Profile{"/x"}}}, M.EvLoadOk{profile}) == M.TrRejected{} : M.Transition}

law failed_rejects_load_ok:
  for +profile: M.Profile
  {M.step(M.Trusted{M.Failed{}}, M.EvLoadOk{profile}) == M.TrRejected{} : M.Transition}

law untrusted_loads_only_on_trust_grant:
  for +event: M.RootEvent
  {M.step(M.Untrusted{}, event) == M.untrusted_spec(event) : M.Transition}

law unloaded_loads_only_on_session_open:
  for +event: M.RootEvent
  {M.step(M.Trusted{M.Unloaded{}}, event) == M.unloaded_spec(event) : M.Transition}

law inflight_loads_only_on_load_result:
  for +event: M.RootEvent
  {M.step(M.Trusted{M.InFlight{}}, event) == M.inflight_spec(event) : M.Transition}

law loaded_loads_only_on_project_change:
  for +profile: M.Profile
  for +event: M.RootEvent
  {M.step(M.Trusted{M.Loaded{profile}}, event) == M.loaded_spec(event) : M.Transition}

law failed_loads_only_on_cooldown:
  for +event: M.RootEvent
  {M.step(M.Trusted{M.Failed{}}, event) == M.failed_spec(event) : M.Transition}

law budget_elapsed_runs_on_host:
  for +application: M.Application
  {M.session_step(application, M.EvBudgetElapsed{}) == M.Host{} : M.Application}

law prepared_does_not_apply:
  for +application: M.Application
  {M.session_step(application, M.EvPrepared{}) == application : M.Application}

law changed_does_not_apply:
  for +application: M.Application
  {M.session_step(application, M.EvChanged{}) == application : M.Application}

law revoked_does_not_rewrite_running_session:
  for +application: M.Application
  {M.session_step(application, M.EvRevoked{}) == application : M.Application}

law opening_with_profile_applies:
  for +application: M.Application
  for +profile: M.Profile
  {M.session_step(application, M.EvOpened{M.Give{profile}}) == M.Applied{profile} : M.Application}

law opening_without_profile_runs_on_host:
  for +application: M.Application
  {M.session_step(application, M.EvOpened{M.Skip{}}) == M.Host{} : M.Application}

law host_is_not_applied:
  {M.is_applied(M.Host{}) == False{} : Bool}

law applied_is_applied:
  for +profile: M.Profile
  {M.is_applied(M.Applied{profile}) == True{} : Bool}

law prepared_host_requires_reload:
  for +profile: M.Profile
  for +fresh: Bool
  {M.needs_reload(M.Trusted{M.Loaded{profile}}, M.Host{}, fresh) == True{} : Bool}

law current_applied_needs_no_reload:
  for +profile: M.Profile
  {M.needs_reload(M.Trusted{M.Loaded{profile}}, M.Applied{profile}, True{}) == False{} : Bool}

law changed_applied_requires_reload:
  for +load: M.Load
  for +profile: M.Profile
  {M.needs_reload(M.Trusted{load}, M.Applied{profile}, False{}) == True{} : Bool}

law revoked_applied_requires_reload:
  for +profile: M.Profile
  for +fresh: Bool
  {M.needs_reload(M.Untrusted{}, M.Applied{profile}, fresh) == True{} : Bool}

law untrusted_starts_no_build:
  for +event: M.RootEvent
  {M.should_load(M.Untrusted{}, event) == False{} : Bool}

law inflight_starts_no_second_build:
  for +event: M.RootEvent
  {M.should_load(M.Trusted{M.InFlight{}}, event) == False{} : Bool}

law trust_read_starts_no_build:
  for +state: M.RootState
  {M.should_load(state, M.EvTrustObserved{}) == False{} : Bool}

law command_starts_no_build:
  for +state: M.RootState
  {M.should_load(state, M.EvCommand{}) == False{} : Bool}

law prepared_host_launch_reports_detected:
  for +profile: M.Profile
  {M.session_status(M.Trusted{M.Loaded{profile}}, M.Host{}) == "detected" : String}

law prepared_applied_launch_reports_ready:
  for +profile: M.Profile
  {M.session_status(M.Trusted{M.Loaded{profile}}, M.Applied{profile}) == "ready" : String}
