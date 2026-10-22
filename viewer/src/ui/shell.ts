export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <header>
      <div class="brand"><span class="brand-icon">⌘</span><div><strong>Dependency atlas</strong><span id="project-name"></span></div></div>
      <nav id="graph-tabs" class="graph-tabs" aria-label="Dependency graphs" hidden></nav>
      <div id="totals" class="totals"></div>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to dark mode" aria-pressed="false">☾ Dark</button>
    </header>
    <div id="workspace" class="workspace">
      <aside id="left-sidebar" class="navigation">
        <div class="sidebar-header"><strong class="sidebar-title">Explorer</strong><button id="toggle-left-sidebar" class="sidebar-toggle" type="button" aria-controls="left-sidebar-content" aria-expanded="true" aria-label="Collapse explorer sidebar">‹</button></div>
        <div id="left-sidebar-content" class="sidebar-content">
        <label class="search"><span>⌕</span><input id="search" type="search" placeholder="Find a source file…" aria-label="Search files" autocomplete="off"></label>
        <div id="search-results" class="search-results" hidden></div>
        <button id="domain-overview" class="domain-button active"><span>Domain Overview</span><span id="domain-overview-count" class="count"></span></button>
        <div id="configured-domains-section">
          <div class="nav-heading">CONFIGURED DOMAINS</div>
          <div id="domains"></div>
        </div>
        <button id="outside" class="domain-button"><span><i style="background:#8793a5"></i>Other files</span><span id="outside-count" class="count"></span></button>
        <div class="navigation-bottom">
          <div class="nav-heading">VISIBLE RELATIONSHIPS</div>
          <label class="option"><input id="show-outside" type="checkbox" checked>Include outside files</label>
          <label class="option"><input id="show-modules" type="checkbox">Module declarations</label>
          <label class="option"><input id="cross-only" type="checkbox">Between domains only</label>
          <div class="nav-heading">DOMAIN DETAIL</div>
          <label class="option"><input id="layer-only" type="checkbox" checked>Show one directory layer</label>
          <div class="edge-legend" aria-label="Arrow line styles">
            <span><span class="edge-sample edge-import"></span>Import</span>
            <span><span class="edge-sample edge-re-export"></span>Export / re-export</span>
            <span><span class="edge-sample edge-module"></span>Module declaration</span>
          </div>
          <button id="diagnostics" class="text-button">Scan details</button>
        </div>
        </div>
      </aside>
      <main>
        <div id="canvas" class="canvas">
          <nav id="package-breadcrumb" class="package-breadcrumb" aria-label="Directory path" hidden></nav>
          <svg id="graph" xmlns="http://www.w3.org/2000/svg" aria-label="File import dependency graph" role="img"><defs></defs><g id="viewport"></g></svg>
          <div id="empty" class="empty" hidden>No files match these filters.</div>
          <div id="canvas-hint" class="canvas-hint">Drag to pan · Scroll to zoom · Click a file to trace imports</div>
          <div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-level">100%</span><button id="zoom-in" aria-label="Zoom in">+</button><button id="fit">Fit</button></div>
          <div id="source-window-host" class="source-window-host" hidden></div>
        </div>
        <footer><span id="visible-count"></span></footer>
      </main>
      <aside id="inspector" class="inspector">
        <div class="sidebar-header"><strong class="sidebar-title">Inspector</strong><button id="toggle-right-sidebar" class="sidebar-toggle" type="button" aria-controls="inspector-content" aria-expanded="true" aria-label="Collapse inspector sidebar">›</button></div>
        <div id="inspector-content" class="inspector-content"></div>
      </aside>
    </div>
    <dialog id="scan-dialog"><div class="dialog-heading"><h2>Scan details</h2><button id="close-dialog" aria-label="Close scan details">×</button></div><div id="scan-content"></div></dialog>`;
}
