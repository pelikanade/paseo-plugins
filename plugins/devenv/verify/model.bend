import Base

type Profile is Data:
  Profile{path: String}

type Load is Data:
  Unloaded{}
  InFlight{}
  Loaded{profile: Profile}
  Failed{}

type RootState is Data:
  Untrusted{}
  Trusted{load: Load}

type RootEvent is Data:
  EvSessionOpen{}
  EvTrustObserved{}
  EvAllowRequested{}
  EvRevoke{}
  EvCommand{}
  EvLoadOk{profile: Profile}
  EvLoadFail{}
  EvCooldownElapsed{}
  EvProjectChanged{}

type Status is Data:
  Denied{}
  Detected{}
  Loading{}
  Ready{}
  Errored{}

type Transition is Data:
  TrRejected{}
  TrAccepted{next: RootState}

type Inject is Data:
  Skip{}
  Give{profile: Profile}

def step(+state: RootState, +event: RootEvent) -> Transition:
  match state event:
    case Untrusted{} EvTrustObserved{}:
      TrAccepted{Trusted{Unloaded{}}}
    case Trusted{Unloaded{}} EvSessionOpen{}:
      TrAccepted{Trusted{InFlight{}}}
    case Trusted{Unloaded{}} EvAllowRequested{}:
      TrAccepted{Trusted{InFlight{}}}
    case Trusted{_} EvRevoke{}:
      TrAccepted{Untrusted{}}
    case Trusted{InFlight{}} EvLoadOk{profile}:
      TrAccepted{Trusted{Loaded{profile}}}
    case Trusted{InFlight{}} EvLoadFail{}:
      TrAccepted{Trusted{Failed{}}}
    case Trusted{Failed{}} EvCooldownElapsed{}:
      TrAccepted{Trusted{InFlight{}}}
    case Trusted{Loaded{_}} EvProjectChanged{}:
      TrAccepted{Trusted{InFlight{}}}
    case _ _:
      TrRejected{}

def status(+state: RootState) -> Status:
  match state:
    case Untrusted{}:
      Denied{}
    case Trusted{Unloaded{}}:
      Detected{}
    case Trusted{InFlight{}}:
      Loading{}
    case Trusted{Loaded{_}}:
      Ready{}
    case Trusted{Failed{}}:
      Errored{}

def published(+status: Status) -> String:
  match status:
    case Denied{}:
      "denied"
    case Detected{}:
      "detected"
    case Loading{}:
      "loading"
    case Ready{}:
      "ready"
    case Errored{}:
      "error"

def decide(+state: RootState, +event: RootEvent) -> Inject:
  match state event:
    case Trusted{Loaded{profile}} EvProjectChanged{}:
      Skip{}
    case Trusted{Loaded{profile}} _:
      Give{profile}
    case _ _:
      Skip{}

def gives(+inject: Inject) -> Bool:
  match inject:
    case Give{_}:
      True{}
    case Skip{}:
      False{}

def is_ready(+status: Status) -> Bool:
  match status:
    case Ready{}:
      True{}
    case _:
      False{}

def injectable(+state: RootState) -> Bool:
  match state:
    case Trusted{Loaded{_}}:
      True{}
    case _:
      False{}

def session_open_spec(+state: RootState) -> Transition:
  match state:
    case Untrusted{}:
      TrRejected{}
    case Trusted{Unloaded{}}:
      TrAccepted{Trusted{InFlight{}}}
    case Trusted{InFlight{}}:
      TrRejected{}
    case Trusted{Loaded{_}}:
      TrRejected{}
    case Trusted{Failed{}}:
      TrRejected{}

def untrusted_spec(+event: RootEvent) -> Transition:
  match event:
    case EvTrustObserved{}:
      TrAccepted{Trusted{Unloaded{}}}
    case EvSessionOpen{}:
      TrRejected{}
    case EvAllowRequested{}:
      TrRejected{}
    case EvRevoke{}:
      TrRejected{}
    case EvCommand{}:
      TrRejected{}
    case EvLoadOk{_}:
      TrRejected{}
    case EvLoadFail{}:
      TrRejected{}
    case EvCooldownElapsed{}:
      TrRejected{}
    case EvProjectChanged{}:
      TrRejected{}

def unloaded_spec(+event: RootEvent) -> Transition:
  match event:
    case EvRevoke{}:
      TrAccepted{Untrusted{}}
    case EvSessionOpen{}:
      TrAccepted{Trusted{InFlight{}}}
    case EvAllowRequested{}:
      TrAccepted{Trusted{InFlight{}}}
    case EvTrustObserved{}:
      TrRejected{}
    case EvCommand{}:
      TrRejected{}
    case EvLoadOk{_}:
      TrRejected{}
    case EvLoadFail{}:
      TrRejected{}
    case EvCooldownElapsed{}:
      TrRejected{}
    case EvProjectChanged{}:
      TrRejected{}

def inflight_spec(+event: RootEvent) -> Transition:
  match event:
    case EvRevoke{}:
      TrAccepted{Untrusted{}}
    case EvLoadOk{profile}:
      TrAccepted{Trusted{Loaded{profile}}}
    case EvLoadFail{}:
      TrAccepted{Trusted{Failed{}}}
    case EvSessionOpen{}:
      TrRejected{}
    case EvTrustObserved{}:
      TrRejected{}
    case EvAllowRequested{}:
      TrRejected{}
    case EvCommand{}:
      TrRejected{}
    case EvCooldownElapsed{}:
      TrRejected{}
    case EvProjectChanged{}:
      TrRejected{}

def loaded_spec(+event: RootEvent) -> Transition:
  match event:
    case EvRevoke{}:
      TrAccepted{Untrusted{}}
    case EvProjectChanged{}:
      TrAccepted{Trusted{InFlight{}}}
    case EvSessionOpen{}:
      TrRejected{}
    case EvTrustObserved{}:
      TrRejected{}
    case EvAllowRequested{}:
      TrRejected{}
    case EvCommand{}:
      TrRejected{}
    case EvLoadOk{_}:
      TrRejected{}
    case EvLoadFail{}:
      TrRejected{}
    case EvCooldownElapsed{}:
      TrRejected{}

def failed_spec(+event: RootEvent) -> Transition:
  match event:
    case EvRevoke{}:
      TrAccepted{Untrusted{}}
    case EvCooldownElapsed{}:
      TrAccepted{Trusted{InFlight{}}}
    case EvSessionOpen{}:
      TrRejected{}
    case EvTrustObserved{}:
      TrRejected{}
    case EvAllowRequested{}:
      TrRejected{}
    case EvCommand{}:
      TrRejected{}
    case EvLoadOk{_}:
      TrRejected{}
    case EvLoadFail{}:
      TrRejected{}
    case EvProjectChanged{}:
      TrRejected{}

type Application is Data:
  Host{}
  Applied{profile: Profile}

type SessionEvent is Data:
  EvOpened{decision: Inject}
  EvBudgetElapsed{}
  EvPrepared{}
  EvChanged{}
  EvRevoked{}

def session_step(+application: Application, +event: SessionEvent) -> Application:
  match event:
    case EvOpened{Give{profile}}:
      Applied{profile}
    case EvOpened{Skip{}}:
      Host{}
    case EvBudgetElapsed{}:
      Host{}
    case EvPrepared{}:
      application
    case EvChanged{}:
      application
    case EvRevoked{}:
      application

def is_applied(+application: Application) -> Bool:
  match application:
    case Applied{_}:
      True{}
    case Host{}:
      False{}

def needs_reload(+state: RootState, +application: Application, +fresh: Bool) -> Bool:
  match state application fresh:
    case Untrusted{} Applied{_} _:
      True{}
    case Trusted{_} Applied{_} False{}:
      True{}
    case Trusted{Loaded{_}} Host{} _:
      True{}
    case _ _ _:
      False{}

def should_load(+state: RootState, +event: RootEvent) -> Bool:
  match state event:
    case Trusted{Unloaded{}} EvSessionOpen{}:
      True{}
    case Trusted{Unloaded{}} EvAllowRequested{}:
      True{}
    case Trusted{Failed{}} EvCooldownElapsed{}:
      True{}
    case Trusted{Loaded{_}} EvProjectChanged{}:
      True{}
    case _ _:
      False{}

def session_status(+state: RootState, +application: Application) -> String:
  match state application:
    case Trusted{Loaded{_}} Host{}:
      "detected"
    case _ _:
      published(status(state))
