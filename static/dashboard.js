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
    const rows = [];
    rows.push(`<div class="tr th"><div>finding</div><div>severity</div><div>tool</div></div>`);

    const items = (findings || []).slice().reverse();
    for (const f of items.slice(0, 200)) {
      const title = (f.title || 'Finding').toString();
      const loc = (f.location || '').toString();
      const tool = (f.tool || '').toString();
      const sev = (f.severity || 'info').toString();
      rows.push(
        `<div class="tr" style="cursor:default">
          <div>${escapeHtml(title)}<div class="muted" style="margin-top:3px">${escapeHtml(loc).slice(0, 110)}</div></div>
          <div>${badgeForSeverity(sev)}</div>
          <div class="muted">${escapeHtml(tool)}</div>
        </div>`
      );
    }

    el('findings').innerHTML = rows.join('');
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
    renderFindings(run.findings, run.findings_total);
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
