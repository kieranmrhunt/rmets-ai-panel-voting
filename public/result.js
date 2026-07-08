const params = new URLSearchParams(location.search);
const pollId = params.get("poll");
const titleEl = document.querySelector("#result-title");
const eyebrowEl = document.querySelector("#eyebrow");
const metaEl = document.querySelector("#result-meta");
const contentEl = document.querySelector("#result-content");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transient(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

async function api(path) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(path, {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
      });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text || "Server did not return JSON" };
      }
      if (!response.ok) {
        const error = new Error(body.error || "Request failed");
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (!transient(error.status || 0) || attempt === 5) break;
      await delay(350 * attempt);
    }
  }
  throw lastError || new Error("Request failed");
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function row(label, valueLabel, width) {
  const item = document.createElement("div");
  item.className = "projector-row";
  item.innerHTML = `
    <div class="projector-row-top">
      <strong>${label}</strong>
      <span>${valueLabel}</span>
    </div>
    <div class="projector-bar"><span style="width:${Math.max(0, Math.min(100, width))}%"></span></div>
  `;
  return item;
}

function renderSingle(poll, result) {
  for (const option of poll.options) {
    const count = result.counts[option.id] || 0;
    const pct = percent(count, result.total);
    contentEl.append(row(`${option.id}. ${option.label}`, `${pct}%`, pct));
  }
}

function renderAllocation(poll, result) {
  const max = Math.max(1, ...Object.values(result.totals || {}));
  for (const option of poll.options) {
    const tokens = result.totals[option.id] || 0;
    contentEl.append(row(option.label, `${tokens} tokens`, Math.round((tokens / max) * 100)));
  }
}

function renderOpen(result) {
  const top = result.topWords || [];
  if (!top.length) {
    contentEl.innerHTML = `<p class="projector-empty">Waiting for words...</p>`;
    return;
  }
  const list = document.createElement("ol");
  list.className = "word-list";
  for (const item of top.slice(0, 8)) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.word}</span><em>${item.count}</em>`;
    list.append(li);
  }
  contentEl.append(list);
}

function renderQuickfire(poll, result) {
  for (const question of poll.questions) {
    const counts = result.counts[question.id] || {};
    const summary = poll.choices
      .map((choice) => `${choice} ${percent(counts[choice] || 0, result.total)}%`)
      .join(" / ");
    contentEl.append(row(question.label, summary, 100));
  }
}

function typeLabel(type) {
  if (type === "allocation") return "100 TOKENS";
  if (type === "open") return "OPEN TEXT";
  if (type === "quickfire") return "QUICK-FIRE";
  return "AUDIENCE VOTE";
}

async function refresh() {
  try {
    const suffix = pollId ? `?pollId=${encodeURIComponent(pollId)}` : "";
    const state = await api(`/api/result${suffix}`);
    const { poll, result } = state;
    eyebrowEl.textContent = `RESULT / ${typeLabel(poll.type)}`;
    titleEl.textContent = poll.title;
    metaEl.textContent = `${result.total} responses`;
    contentEl.innerHTML = "";
    if (poll.type === "single") renderSingle(poll, result);
    if (poll.type === "allocation") renderAllocation(poll, result);
    if (poll.type === "open") renderOpen(result);
    if (poll.type === "quickfire") renderQuickfire(poll, result);
  } catch (error) {
    titleEl.textContent = "Result unavailable";
    contentEl.innerHTML = `<p class="projector-empty">Reconnecting to the vote server...</p>`;
  }
}

refresh();
setInterval(refresh, 1500);
