(() => {
  const el = (id) => document.getElementById(id);

  let selectedRunId = null;
  let sse = null;

  function getApiKey() {
    return localStorage.getItem('hexstrike_api_key') || '';
  }

  function setApiKey(value) {
    localStorage.setItem('hexstrike_api_key', value);
  }

  function authHeaders() {
    const key = getApiKey();
    return key ? { 'Authorization': `Bearer ${key}` } : {};
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...authHeaders(),
      },
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { raw: await res.text() };
    }

    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    return data;
  }

  function badgeForStatus(status) {
    const s = String(status || '').toLowerCase();
    const cls = s === 'completed' || s === 'healthy' ? 'ok'
      : s === 'running' || s === 'queued' || s === 'completed_with_errors' ? 'warn'
      : s === 'failed' || s === 'cancelled' ? 'bad'
      : '';
    return `<span class="badge ${cls}">${status}</span>`;
  }

  function badgeForSeverity(severity) {
    const s = String(severity || 'info').toLowerCase();
    const cls = s === 'critical' || s === 'high' ? 'bad'
      : s === 'medium' ? 'warn'
      : s === 'low' || s === 'info' ? 'ok'
      : '';
    return `<span class="badge ${cls}">${s}</span>`;
  }

  function renderRunsTable(runs) {
    const rows = [];
    rows.push(`<div class="tr th"><div>run_id</div><div>type</div><div>status</div></div>`);

    for (const r of runs) {
      rows.push(
        `<div class="tr" data-run="${r.run_id}">
          <div>${r.run_id.slice(0, 10)}…</div>
          <div>${r.run_type}</div>
          <div>${badgeForStatus(r.status)}</div>
        </div>`
      );
    }

    el('runs-table').innerHTML = rows.join('');
    for (const tr of el('runs-table').querySelectorAll('.tr[data-run]')) {
      tr.addEventListener('click', () => selectRun(tr.dataset.run));
    }
  }

  function renderStages(stages) {
    const rows = [];
    rows.push(`<div class="tr th"><div>stage</div><div>status</div><div>progress</div></div>`);

    for (const s of stages || []) {
      const pct = Math.round((Number(s.progress || 0) * 100));
      rows.push(
        `<div class="tr" style="cursor:default">
          <div>${s.name}</div>
          <div>${badgeForStatus(s.status)}</div>
          <div>
            <div class="progress"><div style="width:${pct}%"></div></div>
          </div>
        </div>`
      );
    }

    el('stages').innerHTML = rows.join('');
  }

  function renderLogs(logs) {
    const lines = (logs || []).slice(-300).map(l => {
      const lvl = (l.level || 'info').toUpperCase();
      return `[${l.ts}] ${lvl} ${l.message}`;
    });
    el('logs').textContent = lines.join('\n');
    el('logs').scrollTop = el('logs').scrollHeight;
  }

  function renderFindings(findings, total) {
    // Legacy no-op: replaced by card renderer
  }

  function normalizeSev(sev) {
    const s = String(sev || 'unknown').toLowerCase();
    if (['critical','high','medium','low','info','unknown'].includes(s)) return s;
    return 'unknown';
  }

  function renderFindingsChips(summary, total) {
    const s = summary || {};
    const critical = Number(s.critical || 0);
    const high = Number(s.high || 0);
    const medium = Number(s.medium || 0);
    const low = Number(s.low || 0);
    const info = Number(s.info || 0);
    const unknown = Number(s.unknown || 0);
    const chips = [
      `<span class="chip critical"><b>Critical</b> ${critical}</span>`,
      `<span class="chip high"><b>High</b> ${high}</span>`,
      `<span class="chip medium"><b>Medium</b> ${medium}</span>`,
      `<span class="chip low"><b>Low</b> ${low}</span>`,
      `<span class="chip info"><b>Info</b> ${info}</span>`,
      `<span class="chip unknown"><b>Other</b> ${unknown}</span>`,
      `<span class="chip"><b>Total</b> ${Number(total || 0)}</span>`,
    ];
    const chipsEl = el('findings-chips');
    if (chipsEl) chipsEl.innerHTML = chips.join('');
  }

  function currentSevFilter() {
    const get = (id) => (el(id) ? el(id).checked : true);
    return {
      critical: get('sev-critical'),
      high: get('sev-high'),
      medium: get('sev-medium'),
      low: get('sev-low'),
      info: get('sev-info'),
      unknown: get('sev-unknown'),
    };
  }

  function matchesSearch(f, q) {
    if (!q) return true;
    const hay = [f.title, f.location, f.tool, f.type].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  function renderFindingCards(findings, summary, total) {
    const cardsEl = el('findings-cards');
    if (!cardsEl) return;

    const q = (el('findings-search')?.value || '').trim().toLowerCase();
    const sevFilter = currentSevFilter();

    const items = (findings || []).slice().reverse();
    const filtered = [];
    for (const f of items) {
      const sev = normalizeSev(f.severity);
      if (!sevFilter[sev]) continue;
      if (!matchesSearch(f, q)) continue;
      filtered.push(f);
      if (filtered.length >= 400) break;
    }

    renderFindingsChips(summary, total);

    const html = filtered.map((f) => {
      const sev = normalizeSev(f.severity);
      const title = escapeHtml(f.title || 'Finding');
      const tool = escapeHtml(f.tool || '');
      const loc = escapeHtml(f.location || '');
      const ts = escapeHtml(f.ts || '');
      const type = escapeHtml(f.type || 'finding');
      const evidence = escapeHtml(f.evidence || '');
      const id = escapeHtml(f.id || '');

      const meta = f.meta && typeof f.meta === 'object' ? f.meta : null;
      const metaBadges = [];
      if (meta?.template_id) metaBadges.push(`<span class="badge">${escapeHtml(meta.template_id)}</span>`);
      if (meta?.cve) metaBadges.push(`<span class="badge">${escapeHtml(meta.cve)}</span>`);
      if (meta?.cwe) metaBadges.push(`<span class="badge">${escapeHtml(meta.cwe)}</span>`);
      if (meta?.cvss_score !== undefined && meta?.cvss_score !== null && String(meta.cvss_score) !== '') {
        metaBadges.push(`<span class="badge">CVSS ${escapeHtml(meta.cvss_score)}</span>`);
      }

      const copyBtn = loc
        ? `<button class="btn-mini" data-copy="${loc}">Copy endpoint</button>`
        : '';

      return `
        <div class="fcard" data-id="${id}">
          <div class="top">
            <div>
              <div class="title">${title}</div>
              <div class="loc">${loc}</div>
            </div>
            <div class="actions">
              <span class="sev ${sev}">${sev.toUpperCase()}</span>
              ${copyBtn}
            </div>
          </div>
          <div class="meta">
            <span class="badge">${type}</span>
            <span class="badge">${tool}</span>
            ${metaBadges.join('')}
            <span class="muted">${ts}</span>
          </div>
          ${evidence ? `
            <details>
              <summary>Evidence</summary>
              <pre>${evidence}</pre>
            </details>
          ` : ''}
        </div>
      `;
    }).join('');

    cardsEl.innerHTML = html || `<div class="detail">No findings match current filters.</div>`;

    // Wire copy buttons
    for (const btn of cardsEl.querySelectorAll('button[data-copy]')) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = btn.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
          setTimeout(() => (btn.textContent = 'Copy endpoint'), 900);
        } catch {
          // ignore
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderRunDetail(run) {
    if (!run) {
      el('run-detail').textContent = 'Select a run…';
      renderStages([]);
      renderLogs([]);
      renderFindings([], 0);
      const chipsEl = el('findings-chips');
      const cardsEl = el('findings-cards');
      if (chipsEl) chipsEl.innerHTML = '';
      if (cardsEl) cardsEl.innerHTML = '';
      return;
    }

    const pct = Math.round(Number(run.progress || 0) * 100);
    el('run-detail').innerHTML = `
      <div class="kv" style="grid-template-columns:110px 1fr">
        <div class="k">run_id</div><div class="v">${run.run_id}</div>
        <div class="k">type</div><div class="v">${run.run_type}</div>
        <div class="k">status</div><div class="v">${badgeForStatus(run.status)}</div>
        <div class="k">findings</div><div class="v">${run.findings_total ?? (run.findings || []).length}</div>
        <div class="k">progress</div><div class="v">
          <div class="progress"><div style="width:${pct}%"></div></div>
        </div>
        <div class="k">updated</div><div class="v">${run.updated_at}</div>
      </div>
    `;

    renderStages(run.stages);
    renderLogs(run.logs);
    renderFindingCards(run.findings, run.findings_summary, run.findings_total);
  }

  function stopSSE() {
    if (sse) {
      sse.close();
      sse = null;
    }
  }

  function startSSE(run) {
    stopSSE();
    if (!run) return;

    const since = run.last_event_id || 0;
    const token = encodeURIComponent(getApiKey());
    const url = token
      ? `/api/runs/${run.run_id}/events?since=${since}&token=${token}`
      : `/api/runs/${run.run_id}/events?since=${since}`;

    sse = new EventSource(url);

    sse.addEventListener('log', () => refreshSelectedRun());
    sse.addEventListener('stage.updated', () => refreshSelectedRun());
    sse.addEventListener('run.status', () => refreshSelectedRun());
    sse.addEventListener('finding', () => refreshSelectedRun());

    sse.onerror = () => {
      // browser will auto-retry; keep it quiet
    };
  }

  async function refreshHealth() {
    try {
      const data = await fetchJson('/health');
      el('health-pill').textContent = `Health: ${data.status}`;
      el('tools-pill').textContent = `Tools: ${data.total_tools_available}/${data.total_tools_count}`;
    } catch (e) {
      el('health-pill').textContent = `Health: ERROR`;
      el('tools-pill').textContent = `Tools: ?/?`;
    }
  }

  async function refreshRuns() {
    const data = await fetchJson('/api/runs?limit=50');
    renderRunsTable(data.runs || []);

    if (selectedRunId) {
      const exists = (data.runs || []).some(r => r.run_id === selectedRunId);
      if (!exists) {
        selectedRunId = null;
        renderRunDetail(null);
      }
    }
  }

  async function refreshSelectedRun() {
    if (!selectedRunId) return;
    try {
      const data = await fetchJson(`/api/runs/${selectedRunId}`);
      const run = data.run;
      renderRunDetail(run);
    } catch {
      // ignore
    }
  }

  function wireFindingsControls() {
    const ids = [
      'findings-search',
      'sev-critical','sev-high','sev-medium','sev-low','sev-info','sev-unknown',
    ];
    for (const id of ids) {
      const node = el(id);
      if (!node) continue;
      const eventName = id === 'findings-search' ? 'input' : 'change';
      node.addEventListener(eventName, () => refreshSelectedRun());
    }
  }

  async function selectRun(runId) {
    selectedRunId = runId;
    const data = await fetchJson(`/api/runs/${runId}`);
    renderRunDetail(data.run);
    startSSE(data.run);
  }

  async function refreshProcesses() {
    try {
      const data = await fetchJson('/api/processes/dashboard');
      el('proc').textContent = data.visual_dashboard || JSON.stringify(data, null, 2);
    } catch (e) {
      el('proc').textContent = String(e);
    }
  }

  async function refreshToolStatus() {
    try {
      const data = await fetchJson('/api/tools/status');
      const rows = [];
      rows.push(`<div class="tr th"><div>tool</div><div>installed</div><div>version</div></div>`);
      for (const item of data.tools || []) {
        rows.push(
          `<div class="tr" style="cursor:default">
            <div>${item.tool}</div>
            <div>${badgeForStatus(item.installed ? 'installed' : 'missing')}</div>
            <div class="muted">${(item.version || '').slice(0, 90)}</div>
          </div>`
        );
      }
      el('tools').innerHTML = rows.join('');
    } catch (e) {
      el('tools').innerHTML = `<div class="detail">${String(e)}</div>`;
    }
  }

  async function loadInstallPlan() {
    try {
      const data = await fetchJson('/api/tools/install-plan');
      el('install-plan').textContent = JSON.stringify(data, null, 2);
      el('install-plan').scrollTop = 0;
    } catch (e) {
      el('install-plan').textContent = String(e);
    }
  }

  async function startRun() {
    const runType = el('run-type').value;
    const target = el('input-target').value.trim();
    const domain = el('input-domain').value.trim();
    const targetUrl = el('input-target-url').value.trim();

    const payload = { run_type: runType };
    if (target) payload.target = target;
    if (domain) payload.domain = domain;
    if (targetUrl) payload.target_url = targetUrl;

    const data = await fetchJson('/api/runs/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    await refreshRuns();
    await selectRun(data.run.run_id);
  }

  async function cancelSelectedRun() {
    if (!selectedRunId) return;
    await fetchJson(`/api/runs/${selectedRunId}/cancel`, { method: 'POST' });
    await refreshSelectedRun();
  }

  function wireUI() {
    el('btn-refresh').addEventListener('click', async () => {
      await refreshHealth();
      await refreshRuns();
      await refreshSelectedRun();
      await refreshProcesses();
      await refreshToolStatus();
    });

    el('btn-reload-runs').addEventListener('click', refreshRuns);
    el('btn-reload-proc').addEventListener('click', refreshProcesses);
    el('btn-reload-tools').addEventListener('click', refreshToolStatus);
    el('btn-install-plan').addEventListener('click', loadInstallPlan);
    el('btn-start').addEventListener('click', startRun);
    el('btn-cancel').addEventListener('click', cancelSelectedRun);

    const keyInput = el('api-key');
    if (keyInput) {
      keyInput.value = getApiKey();
      el('btn-save-key').addEventListener('click', () => setApiKey(keyInput.value.trim()));
      el('btn-clear-key').addEventListener('click', () => { setApiKey(''); keyInput.value = ''; });
    }

    wireFindingsControls();
  }

  async function init() {
    wireUI();
    await refreshHealth();
    await refreshRuns();
    await refreshProcesses();
    await refreshToolStatus();
    const planEl = el('install-plan');
    if (planEl) planEl.textContent = 'Click “Load Plan” to show install commands.';

    setInterval(refreshHealth, 8000);
    setInterval(refreshRuns, 8000);
    setInterval(refreshProcesses, 12000);
  }

  init();
})();
