// dsh-workspace-auto-approval — permission icon and settings card.
window.__ModuleLoader__.load({
  id: "dsh-workspace-auto-approval",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");

    const inject = ["slots", "locale"];
    const SETTINGS_NS = "dsh-workspace-auto-approval";
    const MAX_PROMPT_LENGTH = 8000;
    const LABELS = new Set(["工作区自动审核", "Workspace Auto Approval"]);
    const TARGET_CLASS = "waa-permission-target";
    const ICON_MASK = "url(\"data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z' stroke='black' stroke-width='1.31831' stroke-linejoin='round'/%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M7.62 4.2H8.68L11.55 11.55H9.98L9.34 9.78H6.93L6.29 11.55H4.75L7.62 4.2ZM7.36 8.58H8.91L8.14 6.43L7.36 8.58Z' fill='black'/%3E%3C/svg%3E\")";

    function ChevronIcon({ className }) {
      return react.createElement("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", className },
        react.createElement("path", {
          d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12705 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
          fill: "currentColor",
        }));
    }

    function decoratePermissionButtons() {
      for (const button of document.querySelectorAll("button")) {
        const matches = LABELS.has((button.textContent || "").trim());
        button.classList.toggle(TARGET_CLASS, matches);
      }
    }

    function apply(ctx) {
      const locale = ctx.get("locale");
      const activeLang = () => (locale && locale.getLocale().active === "en") ? "en" : "zh";

      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.plugin = SETTINGS_NS;
        style.textContent = [
          ".waa-permission-target::before{content:\"\";display:inline-block;flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:" + ICON_MASK + " center/contain no-repeat;mask:" + ICON_MASK + " center/contain no-repeat}",
          "button:not([role=menuitem]).waa-permission-target::before{width:14px;height:14px}",
          ".waa-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}",
          ".waa-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}",
          ".waa-headText{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}",
          ".waa-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
          ".waa-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
          ".waa-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
          ".waa-chevronOpen{transform:rotate(180deg)}",
          ".waa-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
          ".waa-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}",
          ".waa-help{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}",
          ".waa-textarea{box-sizing:border-box;width:100%;min-height:180px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:12px/1.55 var(--dsw-font-family);padding:10px 12px;letter-spacing:0}",
          ".waa-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
          ".waa-textarea:disabled{opacity:.55;cursor:default}",
          ".waa-meta{display:flex;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:11px}",
          ".waa-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
          ".waa-btn{height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:0 12px;cursor:pointer}",
          ".waa-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
          ".waa-btn:disabled{opacity:.45;cursor:default}",
          ".waa-status{color:var(--dsw-alias-label-secondary);font-size:11px}",
        ].join("");
        document.head.appendChild(style);

        let scheduled = false;
        const schedule = () => {
          if (scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            decoratePermissionButtons();
          });
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
        decoratePermissionButtons();

        return () => {
          observer.disconnect();
          for (const button of document.querySelectorAll("." + TARGET_CLASS)) button.classList.remove(TARGET_CLASS);
          style.remove();
        };
      }, "workspace-auto-approval: client styles and permission glyph");

      function SettingsCard() {
        const [open, setOpen] = react.useState(false);
        const [state, setState] = react.useState({ prompt: "", defaultPrompt: "", loading: true, saving: false, status: "", revision: 0 });
        const lang = activeLang();
        const T = lang === "en" ? {
          name: "Workspace Auto Approval",
          desc: "Edit the system prompt used for AI permission review",
          label: "Review system prompt",
          help: "The reviewer also receives the workspace, approval reason, matching tool schema, and actual arguments. Tools remain disabled.",
          save: "Save",
          reset: "Restore default",
          saving: "Saving…",
          saved: "Saved",
          restored: "Default restored",
          loadFail: "Load failed",
          saveFail: "Save failed",
          chars: "characters",
        } : {
          name: "工作区自动审核",
          desc: "编辑 AI 权限审核使用的系统提示词",
          label: "审核 System Prompt",
          help: "审核模型还会收到工作区、审批理由、匹配工具 schema 和实际参数；模型不能调用工具。",
          save: "保存",
          reset: "恢复默认",
          saving: "保存中…",
          saved: "已保存",
          restored: "已恢复默认",
          loadFail: "读取失败",
          saveFail: "保存失败",
          chars: "字符",
        };

        const accept = (data, status) => setState((current) => ({
          ...current,
          loading: false,
          saving: false,
          status,
          prompt: data && typeof data.prompt === "string" ? data.prompt : current.prompt,
          defaultPrompt: data && typeof data.defaultPrompt === "string" ? data.defaultPrompt : current.defaultPrompt,
        }));

        react.useEffect(() => {
          let alive = true;
          fetch("/workspace-auto-approval/config")
            .then((response) => response.json())
            .then((data) => { if (alive) accept(data, data && data.ok ? "" : ((data && data.error) || T.loadFail)); })
            .catch(() => { if (alive) setState((current) => ({ ...current, loading: false, status: T.loadFail })); });
          const off = locale ? locale.subscribe(() => setState((current) => ({ ...current, revision: current.revision + 1 }))) : null;
          return () => { alive = false; if (off) off(); };
        }, []);

        const submit = (body, successText) => {
          setState((current) => ({ ...current, saving: true, status: T.saving }));
          fetch("/workspace-auto-approval/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
            .then((response) => response.json())
            .then((data) => accept(data, data && data.ok ? successText : ((data && data.error) || T.saveFail)))
            .catch(() => setState((current) => ({ ...current, saving: false, status: T.saveFail })));
        };

        const busy = state.loading || state.saving;
        const valid = state.prompt.trim().length > 0 && state.prompt.length <= MAX_PROMPT_LENGTH;
        return react.createElement("div", { className: "waa-card" },
          react.createElement("button", { type: "button", className: "waa-head", onClick: () => setOpen((value) => !value) },
            react.createElement("span", { className: "waa-headText" },
              react.createElement("span", { className: "waa-name" }, T.name),
              react.createElement("span", { className: "waa-desc" }, T.desc)),
            react.createElement(ChevronIcon, { className: "waa-chevron" + (open ? " waa-chevronOpen" : "") })),
          open ? react.createElement("div", { className: "waa-body" },
            react.createElement("div", { className: "waa-label" }, T.label),
            react.createElement("div", { className: "waa-help" }, T.help),
            react.createElement("textarea", {
              className: "waa-textarea",
              value: state.prompt,
              maxLength: MAX_PROMPT_LENGTH,
              disabled: busy,
              spellCheck: false,
              onChange: (event) => setState((current) => ({ ...current, prompt: event.target.value, status: "" })),
            }),
            react.createElement("div", { className: "waa-meta" },
              react.createElement("span", null, state.prompt.length + " / " + MAX_PROMPT_LENGTH + " " + T.chars),
              state.status ? react.createElement("span", { className: "waa-status" }, state.status) : null),
            react.createElement("div", { className: "waa-actions" },
              react.createElement("button", { type: "button", className: "waa-btn", disabled: busy || !valid, onClick: () => submit({ prompt: state.prompt }, T.saved) }, T.save),
              react.createElement("button", { type: "button", className: "waa-btn", disabled: busy, onClick: () => submit({ reset: true }, T.restored) }, T.reset))) : null);
      }

      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        key: SETTINGS_NS,
        id: "workspace-auto-approval-settings",
        label: "工作区自动审核",
      }, SettingsCard));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
