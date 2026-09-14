// dsh-quick-file — Client half
// The official ui-reference package still owns the native @ UI. This package only
// contributes the settings card for its Host-side file-reference provider.
window.__ModuleLoader__.load({
  id: 'dsh-quick-file',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const css = [
      '.qf-card{display:flex;flex-direction:column;gap:9px}',
      '.qf-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.qf-label{width:112px;flex:none}',
      '.qf-input{flex:1;min-width:0;background:rgba(0,0,0,.04);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;padding:5px 8px}',
      'body[data-ds-dark-theme] .qf-input{background:rgba(255,255,255,.05)}',
      '.qf-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
      '.qf-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}',
      '.qf-foot{display:flex;align-items:center;gap:10px;margin-top:2px}',
      '.qf-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer}',
      '.qf-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
      '.qf-btn:disabled{opacity:.45;cursor:default}',
      '.qf-status{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.pc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}',
      '.pc-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.pc-head-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.pc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.pc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.pc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.pc-open{transform:rotate(180deg)}',
      '.pc-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px}',
    ].join('')

    const tagId = 'dsh-quick-file/style'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-quick-file'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    const inject = ['slots']

    function SettingsCard() {
      const [open, setOpen] = React.useState(false)
      const [cfg, setCfg] = React.useState({
        everythingUrl: 'http://127.0.0.1:8074', maxResults: 20, maxEntries: 50000,
        excludedDirectories: 'node_modules,.git,dist,build,out,coverage,target,.next,.nuxt,.turbo,.venv,__pycache__,.pytest_cache,.mypy_cache,.gradle',
        loading: true, status: '',
      })
      React.useEffect(() => {
        let alive = true
        fetch('/quick-file/config').then((response) => response.json()).then((data) => {
          if (!alive) return
          setCfg((current) => ({ ...current, ...data, loading: false, status: '' }))
        }).catch(() => {
          if (alive) setCfg((current) => ({ ...current, loading: false, status: '读取失败' }))
        })
        return () => { alive = false }
      }, [])

      const save = () => {
        setCfg((current) => ({ ...current, status: '保存中…' }))
        fetch('/quick-file/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            everythingUrl: cfg.everythingUrl,
            maxResults: Number(cfg.maxResults),
            maxEntries: Number(cfg.maxEntries),
            excludedDirectories: cfg.excludedDirectories,
          }),
        }).then((response) => response.json()).then((data) => {
          if (data?.ok) setCfg((current) => ({ ...current, ...data, loading: false, status: '已保存' }))
          else setCfg((current) => ({ ...current, status: data?.error || '保存失败' }))
        }).catch((error) => setCfg((current) => ({ ...current, status: String(error?.message || '保存失败') })))
      }

      const row = (label, value, onChange, hint, type = 'text') => h('label', { className: 'qf-row' },
        h('span', { className: 'qf-label' }, label),
        h('input', { className: 'qf-input', type, value: value ?? '', onChange: (event) => onChange(event.target.value), spellCheck: false }),
        hint ? h('span', { className: 'qf-hint' }, hint) : null,
      )

      return h('div', { className: 'pc-card' },
        h('button', { type: 'button', className: 'pc-head', onClick: () => setOpen((value) => !value) },
          h('span', { className: 'pc-head-text' },
            h('span', { className: 'pc-name' }, '快速文件搜索'),
            h('span', { className: 'pc-desc' }, '官方 @ 文件候选使用 Everything'),
          ),
          h('span', { className: `pc-chevron${open ? ' pc-open' : ''}` }, '▾'),
        ),
        open ? h('div', { className: 'pc-body' },
          h('div', { className: 'qf-card' },
            row('Everything HTTP', cfg.everythingUrl, (value) => setCfg((current) => ({ ...current, everythingUrl: value })), '留空则回退官方本地扫描'),
            row('忽略目录', cfg.excludedDirectories, (value) => setCfg((current) => ({ ...current, excludedDirectories: value })), '逗号分隔目录名'),
            row('候选数量', cfg.maxResults, (value) => setCfg((current) => ({ ...current, maxResults: value })), '1-200', 'number'),
            row('本地索引上限', cfg.maxEntries, (value) => setCfg((current) => ({ ...current, maxEntries: value })), '回退扫描使用，1-200000', 'number'),
            h('div', { className: 'qf-foot' },
              h('button', { type: 'button', className: 'qf-btn', disabled: cfg.loading, onClick: save }, '保存'),
              cfg.status ? h('span', { className: 'qf-status' }, cfg.status) : null,
            ),
          ),
        ) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'dsh-quick-file',
        id: 'quick-file-settings',
        order: 10,
        label: '快速文件搜索',
      }, SettingsCard))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
