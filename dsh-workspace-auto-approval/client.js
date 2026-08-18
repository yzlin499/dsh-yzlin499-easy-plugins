// dsh-workspace-auto-approval — Client icon decorator.
// The official permission projection has no icon field and PermissionSelect keeps
// its glyph map private, so this narrowly decorates only our exact preset label.
window.__ModuleLoader__.load({
  id: "dsh-workspace-auto-approval",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const inject = ["slots"];
    const LABELS = new Set(["工作区自动审核", "Workspace Auto Approval"]);
    const TARGET_CLASS = "waa-permission-target";
    const ICON_MASK = "url(\"data:image/svg+xml,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z' stroke='black' stroke-width='1.31831' stroke-linejoin='round'/%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M7.62 4.2H8.68L11.55 11.55H9.98L9.34 9.78H6.93L6.29 11.55H4.75L7.62 4.2ZM7.36 8.58H8.91L8.14 6.43L7.36 8.58Z' fill='black'/%3E%3C/svg%3E\")";

    function decorate() {
      for (const button of document.querySelectorAll("button")) {
        const matches = LABELS.has((button.textContent || "").trim());
        button.classList.toggle(TARGET_CLASS, matches);
      }
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.plugin = "dsh-workspace-auto-approval";
        style.textContent = [
          ".waa-permission-target::before{content:\"\";display:inline-block;flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:" + ICON_MASK + " center/contain no-repeat;mask:" + ICON_MASK + " center/contain no-repeat}",
          "button:not([role=menuitem]).waa-permission-target::before{width:14px;height:14px}",
        ].join("");
        document.head.appendChild(style);

        let scheduled = false;
        const schedule = () => {
          if (scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            decorate();
          });
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class"],
        });
        decorate();

        return () => {
          observer.disconnect();
          for (const button of document.querySelectorAll("." + TARGET_CLASS)) button.classList.remove(TARGET_CLASS);
          style.remove();
        };
      }, "workspace-auto-approval: permission glyph");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
