function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}
function u32_to_word(x) {
  let w = { $: "WNil" };
  for (let i = 31; i >= 0; i--) {
    w = { $: "WCon", head: ((x >>> i) & 1) === 1, tail: w };
  }
  return w;
}
function cmp_new(a, b) {
  return { $: a < b ? "LT" : a === b ? "EQ" : "GT" };
}
function nat_divmod(a, b) {
  return b === 0
    ? { $: "Tuple", fst: 0, snd: a }
    : { $: "Tuple", fst: Math.trunc(a / b), snd: a % b };
}
function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}
function nat_host(n) {
  const int = typeof n === "bigint" || Number.isInteger(n);
  if (int && n >= 0 && n <= 2 ** 53) {
    return Number(n);
  }
  return {
    [Symbol.toPrimitive]() {
      throw "bend: a Nat past the largest immediate 2^48-1";
    },
  };
}
function f32_show(x) {
  if (x !== x) {
    return "nan";
  }
  if (!Number.isFinite(x) || Object.is(x, -0)) {
    return x < 0 ? "-inf" : x === 0 ? "-0" : "inf";
  }
  let s = "x";
  for (let p = 1; p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return s;
}
function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}
function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}
function f32_read(s) {
  const re = /^\s*[+-]?((\d+\.?\d*|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  const v = f32_round(s.replace(/inf\w*/i, "Infinity"));
  return re.test(s) ? { $: "Some", value: v } : { $: "None" };
}
const f32_round = function f32_round(s) {
  const d = Number(s);
  const a = Math.abs(d);
  const f = Math.fround(a);
  const g = 2 * a - Math.min(f, 2 ** 128);
  if (g === f || Math.fround(g) !== g || g === Infinity) {
    return Math.sign(d) * f;
  }
  let k = 0;
  while ((a * 2 ** k) % 1 !== 0) {
    k += 1;
  }
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  const n = Number(e ?? 0) - r.length;
  const x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0));
  const y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};
function char_new(code) {
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    throw "bend: " + code + " is not a Unicode scalar value";
  }
  return String.fromCodePoint(code);
}
function array_new(d, v) {
  if (d > 31) {
    throw "bend: an array past the deepest block class 31";
  }
  return Array(2 ** d).fill(v);
}
function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}
function array_rmw(a, i, f) {
  const at = i % a.length;
  const old = a[at];
  a[at] = f(old);
  return { $: "Tuple", fst: a, snd: old };
}
function run_tail(f, x) {
  return { $: "$JMP", f: f.j?.f === f ? f.j : f, x: [x] };
}
function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}
function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(...r.x);
  }
  return r;
}
function run_lib(f, n) {
  return (...a) =>
    a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length) : f(...a);
}
const $0eff = Object.create(null);
function io_eff(k, run, need) {
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = { run, need };
}
function $step$(_state_0, _event_0) {
  if (_state_0.$ === "Untrusted") {
    if (_event_0.$ === "EvTrustObserved") {
      return {
        $: "TrAccepted",
        next: { $: "Trusted", load: { $: "Unloaded" } },
      };
    } else {
      return { $: "TrRejected" };
    }
  } else {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Unloaded") {
      if (_event_0.$ === "EvSessionOpen") {
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "InFlight" } },
        };
      } else if (_event_0.$ === "EvAllowRequested") {
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "InFlight" } },
        };
      } else if (_event_0.$ === "EvRevoke") {
        return { $: "TrAccepted", next: { $: "Untrusted" } };
      } else {
        return { $: "TrRejected" };
      }
    } else if (_t_0.$ === "InFlight") {
      if (_event_0.$ === "EvRevoke") {
        return { $: "TrAccepted", next: { $: "Untrusted" } };
      } else if (_event_0.$ === "EvLoadOk") {
        const _profile_0 = _event_0["profile"];
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "Loaded", profile: _profile_0 } },
        };
      } else if (_event_0.$ === "EvLoadFail") {
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "Failed" } },
        };
      } else {
        return { $: "TrRejected" };
      }
    } else if (_t_0.$ === "Failed") {
      if (_event_0.$ === "EvRevoke") {
        return { $: "TrAccepted", next: { $: "Untrusted" } };
      } else if (_event_0.$ === "EvCooldownElapsed") {
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "InFlight" } },
        };
      } else {
        return { $: "TrRejected" };
      }
    } else {
      if (_event_0.$ === "EvRevoke") {
        return { $: "TrAccepted", next: { $: "Untrusted" } };
      } else if (_event_0.$ === "EvProjectChanged") {
        return {
          $: "TrAccepted",
          next: { $: "Trusted", load: { $: "InFlight" } },
        };
      } else {
        return { $: "TrRejected" };
      }
    }
  }
}
function $status$(_state_0) {
  if (_state_0.$ === "Untrusted") {
    return { $: "Denied" };
  } else {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Unloaded") {
      return { $: "Detected" };
    } else if (_t_0.$ === "InFlight") {
      return { $: "Loading" };
    } else if (_t_0.$ === "Loaded") {
      return { $: "Ready" };
    } else {
      return { $: "Errored" };
    }
  }
}
function $published$(_status_0) {
  if (_status_0.$ === "Denied") {
    return "denied";
  } else if (_status_0.$ === "Detected") {
    return "detected";
  } else if (_status_0.$ === "Loading") {
    return "loading";
  } else if (_status_0.$ === "Ready") {
    return "ready";
  } else {
    return "error";
  }
}
function $decide$(_state_0, _event_0) {
  if (_state_0.$ === "Trusted") {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Loaded") {
      const _profile_0 = _t_0["profile"];
      if (_event_0.$ === "EvProjectChanged") {
        return { $: "Skip" };
      } else {
        return { $: "Give", profile: _profile_0 };
      }
    } else {
      return { $: "Skip" };
    }
  } else {
    return { $: "Skip" };
  }
}
function $gives$(_inject_0) {
  if (_inject_0.$ === "Give") {
    return true;
  } else {
    return false;
  }
}
function $is_ready$(_status_0) {
  if (_status_0.$ === "Ready") {
    return true;
  } else {
    return false;
  }
}
function $injectable$(_state_0) {
  if (_state_0.$ === "Trusted") {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Loaded") {
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
}
function $session_open_spec$(_state_0) {
  if (_state_0.$ === "Untrusted") {
    return { $: "TrRejected" };
  } else {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Unloaded") {
      return {
        $: "TrAccepted",
        next: { $: "Trusted", load: { $: "InFlight" } },
      };
    } else if (_t_0.$ === "InFlight") {
      return { $: "TrRejected" };
    } else if (_t_0.$ === "Loaded") {
      return { $: "TrRejected" };
    } else {
      return { $: "TrRejected" };
    }
  }
}
function $untrusted_spec$(_event_0) {
  if (_event_0.$ === "EvTrustObserved") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "Unloaded" } } };
  } else if (_event_0.$ === "EvSessionOpen") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvAllowRequested") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvRevoke") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCommand") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadOk") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadFail") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCooldownElapsed") {
    return { $: "TrRejected" };
  } else {
    return { $: "TrRejected" };
  }
}
function $unloaded_spec$(_event_0) {
  if (_event_0.$ === "EvRevoke") {
    return { $: "TrAccepted", next: { $: "Untrusted" } };
  } else if (_event_0.$ === "EvSessionOpen") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "InFlight" } } };
  } else if (_event_0.$ === "EvAllowRequested") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "InFlight" } } };
  } else if (_event_0.$ === "EvTrustObserved") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCommand") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadOk") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadFail") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCooldownElapsed") {
    return { $: "TrRejected" };
  } else {
    return { $: "TrRejected" };
  }
}
function $inflight_spec$(_event_0) {
  if (_event_0.$ === "EvRevoke") {
    return { $: "TrAccepted", next: { $: "Untrusted" } };
  } else if (_event_0.$ === "EvLoadOk") {
    const _profile_0 = _event_0["profile"];
    return {
      $: "TrAccepted",
      next: { $: "Trusted", load: { $: "Loaded", profile: _profile_0 } },
    };
  } else if (_event_0.$ === "EvLoadFail") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "Failed" } } };
  } else if (_event_0.$ === "EvSessionOpen") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvTrustObserved") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvAllowRequested") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCommand") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCooldownElapsed") {
    return { $: "TrRejected" };
  } else {
    return { $: "TrRejected" };
  }
}
function $loaded_spec$(_event_0) {
  if (_event_0.$ === "EvRevoke") {
    return { $: "TrAccepted", next: { $: "Untrusted" } };
  } else if (_event_0.$ === "EvProjectChanged") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "InFlight" } } };
  } else if (_event_0.$ === "EvSessionOpen") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvTrustObserved") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvAllowRequested") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCommand") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadOk") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadFail") {
    return { $: "TrRejected" };
  } else {
    return { $: "TrRejected" };
  }
}
function $failed_spec$(_event_0) {
  if (_event_0.$ === "EvRevoke") {
    return { $: "TrAccepted", next: { $: "Untrusted" } };
  } else if (_event_0.$ === "EvCooldownElapsed") {
    return { $: "TrAccepted", next: { $: "Trusted", load: { $: "InFlight" } } };
  } else if (_event_0.$ === "EvSessionOpen") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvTrustObserved") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvAllowRequested") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvCommand") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadOk") {
    return { $: "TrRejected" };
  } else if (_event_0.$ === "EvLoadFail") {
    return { $: "TrRejected" };
  } else {
    return { $: "TrRejected" };
  }
}
function $session_step$(_application_0, _event_0) {
  if (_event_0.$ === "EvOpened") {
    const _t_0 = _event_0["decision"];
    if (_t_0.$ === "Give") {
      const _profile_0 = _t_0["profile"];
      return { $: "Applied", profile: _profile_0 };
    } else {
      return { $: "Host" };
    }
  } else if (_event_0.$ === "EvBudgetElapsed") {
    return { $: "Host" };
  } else if (_event_0.$ === "EvPrepared") {
    return _application_0;
  } else if (_event_0.$ === "EvChanged") {
    return _application_0;
  } else {
    return _application_0;
  }
}
function $is_applied$(_application_0) {
  if (_application_0.$ === "Applied") {
    return true;
  } else {
    return false;
  }
}
function $needs_reload$(_state_0, _application_0, _fresh_0) {
  if (_state_0.$ === "Untrusted") {
    if (_application_0.$ === "Applied") {
      return true;
    } else {
      return false;
    }
  } else {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Loaded") {
      if (_application_0.$ === "Applied") {
        if (!_fresh_0) {
          return true;
        } else {
          return false;
        }
      } else {
        return true;
      }
    } else {
      if (_application_0.$ === "Applied") {
        if (!_fresh_0) {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
  }
}
function $should_load$(_state_0, _event_0) {
  if (_state_0.$ === "Trusted") {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Unloaded") {
      if (_event_0.$ === "EvSessionOpen") {
        return true;
      } else if (_event_0.$ === "EvAllowRequested") {
        return true;
      } else {
        return false;
      }
    } else if (_t_0.$ === "Failed") {
      if (_event_0.$ === "EvCooldownElapsed") {
        return true;
      } else {
        return false;
      }
    } else if (_t_0.$ === "Loaded") {
      if (_event_0.$ === "EvProjectChanged") {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else {
    return false;
  }
}
function $session_status$(_state_0, _application_0) {
  if (_state_0.$ === "Trusted") {
    const _t_0 = _state_0["load"];
    if (_t_0.$ === "Loaded") {
      const __0 = _t_0["profile"];
      if (_application_0.$ === "Host") {
        return "detected";
      } else {
        return $published$(
          $status$({ $: "Trusted", load: { $: "Loaded", profile: __0 } }),
        );
      }
    } else {
      return $published$($status$({ $: "Trusted", load: _t_0 }));
    }
  } else {
    return $published$($status$(_state_0));
  }
}
export default {
  step: run_lib((a0, a1) => {
    const r = run_loop($step$(a0, a1));
    a0;
    a1;
    return r;
  }, 2),
  status: run_lib((a0) => {
    const r = run_loop($status$(a0));
    a0;
    return r;
  }, 1),
  published: run_lib((a0) => {
    const r = run_loop($published$(a0));
    a0;
    return r;
  }, 1),
  decide: run_lib((a0, a1) => {
    const r = run_loop($decide$(a0, a1));
    a0;
    a1;
    return r;
  }, 2),
  gives: run_lib((a0) => {
    const r = run_loop($gives$(a0));
    a0;
    return r;
  }, 1),
  is_ready: run_lib((a0) => {
    const r = run_loop($is_ready$(a0));
    a0;
    return r;
  }, 1),
  injectable: run_lib((a0) => {
    const r = run_loop($injectable$(a0));
    a0;
    return r;
  }, 1),
  session_open_spec: run_lib((a0) => {
    const r = run_loop($session_open_spec$(a0));
    a0;
    return r;
  }, 1),
  untrusted_spec: run_lib((a0) => {
    const r = run_loop($untrusted_spec$(a0));
    a0;
    return r;
  }, 1),
  unloaded_spec: run_lib((a0) => {
    const r = run_loop($unloaded_spec$(a0));
    a0;
    return r;
  }, 1),
  inflight_spec: run_lib((a0) => {
    const r = run_loop($inflight_spec$(a0));
    a0;
    return r;
  }, 1),
  loaded_spec: run_lib((a0) => {
    const r = run_loop($loaded_spec$(a0));
    a0;
    return r;
  }, 1),
  failed_spec: run_lib((a0) => {
    const r = run_loop($failed_spec$(a0));
    a0;
    return r;
  }, 1),
  session_step: run_lib((a0, a1) => {
    const r = run_loop($session_step$(a0, a1));
    a0;
    a1;
    return r;
  }, 2),
  is_applied: run_lib((a0) => {
    const r = run_loop($is_applied$(a0));
    a0;
    return r;
  }, 1),
  needs_reload: run_lib((a0, a1, a2) => {
    const r = run_loop($needs_reload$(a0, a1, a2));
    a0;
    a1;
    a2;
    return r;
  }, 3),
  should_load: run_lib((a0, a1) => {
    const r = run_loop($should_load$(a0, a1));
    a0;
    a1;
    return r;
  }, 2),
  session_status: run_lib((a0, a1) => {
    const r = run_loop($session_status$(a0, a1));
    a0;
    a1;
    return r;
  }, 2),
};
