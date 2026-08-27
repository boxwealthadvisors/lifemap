"""Copy LifeMap HTML mockups into public/lifemap and inject a same-script React bridge."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\user\Downloads")
OUT = ROOT / "public" / "lifemap"

FILES = {
    "fp": ("lifemap-fp-calculator.html", "fp-calculator.html"),
    "assets": ("lifemap-assets.html", "assets.html"),
    "work": ("lifemap-work-assets.html", "work-assets.html"),
    "goals": ("lifemap-goals.html", "goals.html"),
    "loans": ("lifemap-loans.html", "loans.html"),
    "expenses": ("lifemap-expenses.html", "expenses.html"),
}

MARKER_START = "/* === LIFEMAP_BRIDGE_START === */"
MARKER_END = "/* === LIFEMAP_BRIDGE_END === */"

BRIDGE = r'''
__MARKER_START__
(function(){
  var PAGE = "__PAGE__";
  var LM_SOURCES = [];
  var ROUTES = {
    "lifemap-fp-calculator.html": "/",
    "fp-calculator.html": "/",
    "lifemap-assets.html": "/assets",
    "assets.html": "/assets",
    "lifemap-work-assets.html": "/work-assets",
    "work-assets.html": "/work-assets",
    "lifemap-goals.html": "/goals",
    "goals.html": "/goals",
    "lifemap-loans.html": "/loans",
    "loans.html": "/loans",
    "lifemap-expenses.html": "/expenses",
    "expenses.html": "/expenses",
    "lifemap-insurance.html": "/insurance",
    "insurance.html": "/insurance"
  };

  function post(type, payload){
    try { parent.postMessage({ source:"lifemap-mockup", type:type, page:PAGE, payload:payload||null }, "*"); }
    catch (e) {}
  }

  function fileOf(href){
    if (!href) return "";
    var clean = String(href).split("#")[0].split("?")[0];
    var parts = clean.split("/");
    return parts[parts.length-1];
  }

  function replaceList(target, next){
    if (!target || !next) return;
    target.splice.apply(target, [0, target.length].concat(next));
  }

  function blankOwned(){
    if (!/\bowned=1\b/.test(String(location.search || ""))) return;
    try {
      if (PAGE === "fp" && typeof S !== "undefined") {
        S.salary = 0; S.finAssets = 0; S.personalAssets = 0;
        if (S.loans) replaceList(S.loans, []);
        if (S.goals) replaceList(S.goals, []);
        if (S.exp) replaceList(S.exp, []);
        if (S.expRegister) replaceList(S.expRegister, []);
        if (S.work) replaceList(S.work, []);
        if (S.household) replaceList(S.household, []);
        if (typeof renderFamily === "function") renderFamily();
        var lock = document.querySelector(".lockover");
        if (lock) lock.style.display = "none";
      }
      if (typeof ROWS !== "undefined") replaceList(ROWS, []);
      if (PAGE === "loans" && typeof PLAN !== "undefined") replaceList(PLAN, []);
      if (typeof refresh === "function") refresh();
    } catch (e) {}
  }

  function getState(){
    try {
      if (PAGE === "fp") {
        return { S: { age:S.age, salary:S.salary, gSal:S.gSal, workTill:S.workTill, finAssets:S.finAssets, personalAssets:S.personalAssets, loans:S.loans.slice(), goals:S.goals.slice(), exp:S.exp.slice(), expRegister:(S.expRegister||[]).slice(), work:(S.work||[]).slice(), household:(S.household||[]).slice(), gRet:S.gRet, gInf:S.gInf, lifeTo:S.lifeTo } };
      }
      if (PAGE === "assets") return { ROWS: ROWS.slice(), UNASSIGNED: UNASSIGNED, MODE: MODE, HZ: HZ, GOALS: (typeof GOALS !== "undefined" ? GOALS.slice() : []) };
      if (PAGE === "work") return { ROWS: ROWS.slice(), UNASSIGNED: UNASSIGNED, AGE: AGE };
      if (PAGE === "goals") return { ROWS: ROWS.slice(), AGE: AGE, RET: RET, BASIS: BASIS, ASSETS: (typeof ASSETS !== "undefined" ? ASSETS.slice() : []), INCOMES: (typeof INCOMES !== "undefined" ? INCOMES.slice() : []) };
      if (PAGE === "loans") return { ROWS: ROWS.slice(), PLAN: PLAN.slice(), VIEW: VIEW };
      if (PAGE === "expenses") return { ROWS: ROWS.slice(), AGE: AGE, LIFE: LIFE, GINF: GINF, BASIS: BASIS, MODE: MODE, SOURCES: LM_SOURCES.slice() };
    } catch (e) { console.error(e); }
    return {};
  }

  function hydrateFp(st){
    if (!st || !st.S) return;
    var src = st.S;
    S.age = src.age; S.salary = src.salary; S.gSal = src.gSal; S.workTill = src.workTill;
    S.finAssets = src.finAssets; S.personalAssets = src.personalAssets;
    S.gRet = src.gRet; S.gInf = src.gInf; S.lifeTo = src.lifeTo;
    if (src.loans) replaceList(S.loans, src.loans);
    if (src.goals) replaceList(S.goals, src.goals);
    if (src.exp) replaceList(S.exp, src.exp);
    if (src.expRegister) {
      if (!S.expRegister) S.expRegister = [];
      replaceList(S.expRegister, src.expRegister);
    }
    if (src.work) {
      if (!S.work) S.work = [];
      replaceList(S.work, src.work);
    }
    if (src.household) {
      if (!S.household) S.household = [];
      replaceList(S.household, src.household);
    }
    if (typeof renderFamily === "function") renderFamily();
    var set = function(id, val){ var el = $(id); if (el) el.value = val; };
    var setTxt = function(id, val){ var el = $(id); if (el) el.textContent = val; };
    set("i-age", S.age);
    set("i-salary", S.salary);
    set("i-gsal", S.gSal);
    set("i-gsal2", S.gSal);
    set("i-work-age", S.workTill);
    set("i-life-age", S.lifeTo);
    set("i-fin-assets", S.finAssets);
    set("i-personal-assets", S.personalAssets);
    set("i-gret", S.gRet); setTxt("o-gret", Number(S.gRet).toFixed(1)+"%");
    set("i-ginf", S.gInf); setTxt("o-ginf", Number(S.gInf).toFixed(1)+"%");
    setTxt("o-gsal2", Number(S.gSal).toFixed(1)+"%");
    set("i-life", S.lifeTo); setTxt("o-life", S.lifeTo);
    ["loans","goals","exp"].forEach(renderRows);
    refresh();
  }

  function setState(st){
    if (!st) return;
    try {
      if (PAGE === "fp") { hydrateFp(st); return; }
      if (PAGE === "assets") {
        if (st.ROWS) replaceList(ROWS, st.ROWS);
        if (typeof st.UNASSIGNED === "number") { try { UNASSIGNED = st.UNASSIGNED; } catch(e) {} }
        if (st.GOALS) { try { GOALS = st.GOALS; } catch(e) {} }
        if (st.MODE) MODE = st.MODE;
        if (st.HZ) HZ = st.HZ;
        refresh();
        return;
      }
      if (PAGE === "work") {
        if (st.ROWS) replaceList(ROWS, st.ROWS);
        if (typeof st.UNASSIGNED === "number") { try { UNASSIGNED = st.UNASSIGNED; } catch(e) {} }
        if (typeof st.AGE === "number" || (st.AGE != null && st.AGE !== "")) {
          var nextAge = Number(st.AGE);
          if (isFinite(nextAge) && nextAge > 0) {
            AGE = nextAge;
            var ageEl = $("i-age");
            if (ageEl) ageEl.value = AGE;
          }
        }
        var maxId = 0;
        ROWS.forEach(function(r){
          var n = Number(r.id);
          if (isFinite(n) && n > maxId && n < 1e9) maxId = n;
        });
        try { NEXT_ID = maxId + 1; } catch(e) {}
        refresh();
        return;
      }
      if (PAGE === "goals") {
        if (st.ROWS) replaceList(ROWS, st.ROWS);
        if (typeof st.AGE === "number" || (st.AGE != null && st.AGE !== "")) {
          var gAge = Number(st.AGE);
          if (isFinite(gAge) && gAge > 0) { AGE = gAge; var a=$("i-age"); if(a) a.value=AGE; }
        }
        if (typeof st.RET === "number") { RET = st.RET; var r=$("i-ret"); if(r) r.value=RET; }
        if (st.ASSETS) { try { ASSETS = st.ASSETS; } catch(e) {} }
        if (st.INCOMES) { try { INCOMES = st.INCOMES; } catch(e) {} }
        if (st.BASIS) BASIS = st.BASIS;
        refresh();
        return;
      }
      if (PAGE === "loans") {
        if (st.ROWS) replaceList(ROWS, st.ROWS);
        if (st.PLAN) replaceList(PLAN, st.PLAN);
        if (typeof REGS !== "undefined") {
          REGS.cur.list = ROWS;
          REGS.plan.list = PLAN;
        }
        if (st.VIEW) VIEW = st.VIEW;
        refresh();
        return;
      }
      if (PAGE === "expenses") {
        if (st.ROWS) replaceList(ROWS, st.ROWS);
        if (typeof st.AGE === "number" || (st.AGE != null && st.AGE !== "")) {
          var eAge = Number(st.AGE);
          if (isFinite(eAge) && eAge > 0) { AGE = eAge; var e1=$("i-age"); if(e1) e1.value=AGE; }
        }
        if (typeof st.LIFE === "number") { LIFE = st.LIFE; var e2=$("i-life"); if(e2) e2.value=LIFE; }
        if (typeof st.GINF === "number") { GINF = st.GINF; var e3=$("i-ginf"); if(e3) e3.value=GINF; }
        if (st.BASIS) BASIS = st.BASIS;
        if (st.MODE) MODE = st.MODE;
        refresh();
        if (st.SOURCES) setSources(st.SOURCES);
      }
    } catch (err) {
      console.error("LifeMap setState failed", err);
    }
  }

  function setSources(names){
    LM_SOURCES = names || [];
    var list = document.getElementById("lm-src-list");
    if (!list) {
      list = document.createElement("datalist");
      list.id = "lm-src-list";
      document.body.appendChild(list);
      document.addEventListener("focusin", function(e){
        var inp = e.target;
        if (inp && inp.getAttribute && inp.getAttribute("data-k") === "src") {
          inp.setAttribute("list", "lm-src-list");
        }
      });
    }
    list.innerHTML = (names || []).map(function(n){
      return "<option value=\"" + String(n).replace(/"/g, "&quot;") + "\"></option>";
    }).join("");
  }

  function ensureAcctCss(){
    if (document.getElementById("lm-acct-css")) return;
    var s = document.createElement("style");
    s.id = "lm-acct-css";
    s.textContent = ".topbar{z-index:90}.lm-acct{position:relative;display:inline-flex;align-items:center;z-index:91}.lm-acct.open{z-index:120}.lm-acct .tlink{display:inline-flex!important;align-items:center;gap:4px;cursor:pointer}.lm-acct-menu{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:188px;background:#fff;border:1px solid #dbe2ea;border-radius:10px;box-shadow:0 12px 28px rgba(10,31,68,.16);padding:6px;z-index:200}.lm-acct.open .lm-acct-menu{display:block}.lm-acct-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;border-radius:8px;font:inherit;font-size:14px;font-weight:600;color:#003c8f;cursor:pointer}.lm-acct-menu button:hover{background:#eef3fa}.lm-acct-menu button.out{color:#b42318}";
    document.head.appendChild(s);
  }

  function setAccount(label){
    ensureAcctCss();
    var acts = document.querySelector(".tier0 .acts");
    var link = document.querySelector(".tier0 .tlink");
    if (!acts || !link) return;
    var wrap = link.closest(".lm-acct");
    if (label) {
      if (!wrap) {
        wrap = document.createElement("span");
        wrap.className = "lm-acct";
        link.parentNode.insertBefore(wrap, link);
        wrap.appendChild(link);
        var menu = document.createElement("div");
        menu.className = "lm-acct-menu";
        menu.innerHTML = '<button type="button" data-act="profile">Your profile</button><button type="button" data-act="logout" class="out">Log out</button>';
        wrap.appendChild(menu);
        menu.addEventListener("click", function(e){
          var btn = e.target.closest("button");
          if (!btn) return;
          wrap.classList.remove("open");
          var act = btn.getAttribute("data-act");
          if (act === "profile") post("navigate", { path: "/profile" });
          if (act === "logout") post("logout");
        });
        link.addEventListener("click", function(e){
          e.preventDefault();
          e.stopPropagation();
          wrap.classList.toggle("open");
        });
        document.addEventListener("click", function(ev){
          if (!wrap.contains(ev.target)) wrap.classList.remove("open");
        });
      }
      link.setAttribute("href", "#account");
      link.innerHTML = String(label).replace(/</g, "&lt;") + ' <span aria-hidden="true">▾</span>';
    } else {
      if (wrap) {
        acts.insertBefore(link, wrap);
        wrap.remove();
      }
      link.textContent = "Sign in";
      link.setAttribute("href", "#register");
    }
  }

  document.querySelectorAll(".ptab.gate").forEach(function(a){
    var label = (a.textContent || "").replace(/\s+/g," ").trim();
    if (/insurance/i.test(label)) {
      a.classList.remove("gate");
      a.removeAttribute("title");
      a.setAttribute("href", "/insurance");
    }
  });

  document.querySelectorAll("a").forEach(function(a){
    a.addEventListener("click", function(e){
      var href = a.getAttribute("href") || "";
      var file = fileOf(href);
      var label = (a.textContent || "").replace(/\s+/g," ").trim();
      if (/^insurance$/i.test(label) && (a.classList.contains("ptab") || href === "/insurance" || href === "#")) {
        e.preventDefault();
        post("navigate", { path: "/insurance" });
        return;
      }
      if (a.classList.contains("gate")) { e.preventDefault(); return; }
      if (ROUTES[file]) {
        e.preventDefault();
        post("navigate", { path: ROUTES[file] });
      }
    });
  });

  document.querySelectorAll(".tier0 .tlink, .tier0 .btn, .wallcta .btn, .wallcta a").forEach(function(a){
    a.addEventListener("click", function(e){
      if (a.closest && a.closest(".lm-acct")) return;
      e.preventDefault();
      var text = (a.textContent || "").replace(/\s+/g," ").trim();
      if (/save/i.test(text) && !a.closest(".wallcta")) post("save", getState());
      else post("auth", { action: "signin", label: text });
    });
  });

  document.addEventListener("click", function(e){
    var saveBtn = e.target.closest && e.target.closest(".rb.save");
    var delBtn = e.target.closest && e.target.closest(".rb.del");
    if (saveBtn && saveBtn.id === "ear-add") return;
    if (saveBtn || delBtn) {
      setTimeout(function(){ post(delBtn ? "row-delete" : "row-save", getState()); }, 30);
    }
  }, true);

  var rowSaveTimer = null;
  function queueRowSave(){
    clearTimeout(rowSaveTimer);
    rowSaveTimer = setTimeout(function(){ post("row-save", getState()); }, 500);
  }
  function isPlanField(el){
    if (!el || !el.closest) return false;
    if (el.closest(".earpop")) return false;
    if (el.readOnly || el.disabled) return false;
    if (el.id === "search") return false;
    if (el.classList && (el.classList.contains("cell") || el.classList.contains("inp"))) return true;
    if (el.hasAttribute && el.hasAttribute("data-k")) return true;
    if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") return true;
    return false;
  }
  document.addEventListener("input", function(e){
    if (isPlanField(e.target)) queueRowSave();
  });
  document.addEventListener("change", function(e){
    if (isPlanField(e.target)) queueRowSave();
  });
  document.addEventListener("focusout", function(e){
    if (!isPlanField(e.target)) return;
    clearTimeout(rowSaveTimer);
    post("row-save", getState());
  });

  function snapNumericCaret(el){
    if (!el || el.tagName !== "INPUT" || el.readOnly || el.disabled) return;
    var money = el.classList && el.classList.contains("money");
    var mode = el.getAttribute("inputmode");
    if (!money && mode !== "decimal" && mode !== "numeric") return;
    try {
      if (typeof el.setSelectionRange !== "function") return;
      var len = String(el.value || "").length;
      if (el.selectionStart === 0 && el.selectionEnd === 0) el.setSelectionRange(len, len);
    } catch (err) {}
  }
  document.addEventListener("focusin", function(e){
    var el = e.target;
    requestAnimationFrame(function(){ snapNumericCaret(el); });
  });
  document.addEventListener("mouseup", function(e){
    snapNumericCaret(e.target);
  });

  var ageTimer = null;
  ["i-age","i-life","i-life-age","i-work-age","i-ginf","i-ret"].forEach(function(id){
    var el = $(id);
    if (!el) return;
    el.addEventListener("change", function(){
      clearTimeout(ageTimer);
      ageTimer = setTimeout(function(){ post("row-save", getState()); }, 200);
    });
  });

  window.__LIFEMAP__ = {
    page: PAGE,
    getState: getState,
    setState: setState,
    setAccount: setAccount,
    refresh: refresh,
    applyClassify: function(st){
      if (typeof applyExpenseClassify === "function") applyExpenseClassify(st);
    }
  };
  blankOwned();
  post("ready", getState());
})();
__MARKER_END__
'''

BRIDGE = BRIDGE.replace("__MARKER_START__", MARKER_START).replace("__MARKER_END__", MARKER_END)


def strip_old_bridge(script: str) -> str:
    if MARKER_START in script:
        script = re.sub(
            re.escape(MARKER_START) + r"[\s\S]*?" + re.escape(MARKER_END),
            "",
            script,
        )
    return script.rstrip() + "\n"


def inject(html: str, page: str) -> str:
    scripts = list(re.finditer(r"<script>([\s\S]*?)</script>", html))
    if not scripts:
        raise SystemExit(f"No script in {page}")
    last = scripts[-1]
    body = strip_old_bridge(last.group(1))
    bridged = body + "\n" + BRIDGE.replace("__PAGE__", page) + "\n"
    return html[: last.start()] + "<script>" + bridged + "</script>" + html[last.end() :]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for page, (src_name, dest_name) in FILES.items():
        repo_src = ROOT / "src" / "mockups" / src_name
        src = repo_src if repo_src.exists() else (SRC / src_name)
        if not src.exists():
            raise SystemExit(f"Missing mockup: {src_name}")
        html = src.read_text(encoding="utf-8")
        html = html.replace("const UNASSIGNED = 0", "let UNASSIGNED = 0")
        html = inject(html, page)
        dest = OUT / dest_name
        dest.write_text(html, encoding="utf-8")
        print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
