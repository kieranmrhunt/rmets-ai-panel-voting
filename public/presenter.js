const pollListEl = document.querySelector("#poll-list");
const resultsEl = document.querySelector("#results");
let state = null;
let adminToken = new URLSearchParams(location.search).get("token") || localStorage.getItem("rmets-admin-token") || "";
if (adminToken) localStorage.setItem("rmets-admin-token", adminToken);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { "x-admin-token": adminToken } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function pct(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function activePoll() {
  return state.polls.find((poll) => poll.id === state.activePollId);
}

function renderPollList() {
  pollListEl.innerHTML = "<h2>Polls</h2>";
  for (const poll of state.polls) {
    const button = document.createElement("button");
    button.className = `poll-button ${poll.id === state.activePollId ? "active" : ""}`;
    button.innerHTML = `<strong>${poll.title}</strong><br><span class="muted">Prompt ${poll.promptSlide} / result ${poll.resultSlide} / ${poll.type}</span>`;
    button.addEventListener("click", async () => {
      await api("/api/active", { method: "POST", body: JSON.stringify({ pollId: poll.id }) });
      await refresh();
    });
    pollListEl.append(button);
  }
}

function resultRow(label, count, total) {
  const percent = pct(count, total);
  const row = document.createElement("div");
  row.className = "result-row";
  row.innerHTML = `<strong>${label}</strong><span>${count} votes / ${percent}%</span><div class="bar"><span style="width:${percent}%"></span></div>`;
  return row;
}

function renderSingle(poll, result) {
  const wrap = document.createElement("div");
  for (const option of poll.options) {
    wrap.append(resultRow(`${option.id}. ${option.label}`, result.counts[option.id] || 0, result.total));
  }
  return wrap;
}

function renderAllocation(poll, result) {
  const max = Math.max(1, ...Object.values(result.totals || {}));
  const wrap = document.createElement("div");
  for (const option of poll.options) {
    const value = result.totals[option.id] || 0;
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `<strong>${option.label}</strong><span>${value} tokens total</span><div class="bar"><span style="width:${Math.round((value / max) * 100)}%"></span></div>`;
    wrap.append(row);
  }
  return wrap;
}

function renderOpen(result) {
  const wrap = document.createElement("div");
  for (const item of result.topWords || []) {
    wrap.append(resultRow(item.word, item.count, result.total));
  }
  if (!result.topWords?.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No words yet.";
    wrap.append(p);
  }
  return wrap;
}

function renderQuickfire(poll, result) {
  const wrap = document.createElement("div");
  for (const question of poll.questions) {
    const row = document.createElement("div");
    row.className = "result-row";
    const counts = result.counts[question.id] || {};
    row.innerHTML = `<strong>${question.label}</strong><span>${poll.choices.map((choice) => `${choice} ${pct(counts[choice] || 0, result.total)}%`).join(" / ")}</span>`;
    wrap.append(row);
  }
  return wrap;
}

function renderResults() {
  const poll = activePoll();
  const result = state.results[poll.id];
  resultsEl.innerHTML = `<h2>${poll.title}</h2><p class="muted">${result.total} responses. Result slide ${poll.resultSlide}.</p>`;
  if (poll.type === "single") resultsEl.append(renderSingle(poll, result));
  if (poll.type === "allocation") resultsEl.append(renderAllocation(poll, result));
  if (poll.type === "open") resultsEl.append(renderOpen(result));
  if (poll.type === "quickfire") resultsEl.append(renderQuickfire(poll, result));

  const actions = document.createElement("div");
  actions.className = "actions";
  const reset = document.createElement("button");
  reset.className = "danger";
  reset.textContent = "Reset this poll";
  reset.addEventListener("click", async () => {
    if (!confirm(`Reset responses for ${poll.title}?`)) return;
    await api("/api/reset", { method: "POST", body: JSON.stringify({ pollId: poll.id }) });
    await refresh();
  });
  actions.append(reset);
  resultsEl.append(actions);
}

async function refresh() {
  try {
    state = await api("/api/state");
    renderPollList();
    renderResults();
  } catch (error) {
    if (error.message.includes("token")) {
      const token = prompt("Presenter token");
      if (token) {
        adminToken = token;
        localStorage.setItem("rmets-admin-token", token);
        return refresh();
      }
    }
    resultsEl.innerHTML = `<p class="status">${error.message}</p>`;
  }
}

refresh();
setInterval(refresh, 2000);
