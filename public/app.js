const statusEl = document.querySelector("#status");
const formEl = document.querySelector("#poll-form");
const titleEl = document.querySelector("#poll-title");
const metaEl = document.querySelector("#poll-meta");

const voterId = (() => {
  const key = "rmets-voter-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
})();

let state = null;
let renderedPollId;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transient(status) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

async function parseResponse(response) {
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
}

async function api(path, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(path, {
        cache: "no-store",
        ...options,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          ...(options.headers || {}),
        },
      });
      return await parseResponse(response);
    } catch (error) {
      lastError = error;
      if (!transient(error.status || 0) || attempt === 5) break;
      await delay(350 * attempt);
    }
  }
  throw lastError || new Error("Request failed");
}

function activePoll() {
  return state.activePoll;
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${tone}`;
}

function submitButton() {
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = document.createElement("button");
  button.className = "primary";
  button.type = "submit";
  button.textContent = "Submit vote";
  actions.append(button);
  return actions;
}

function renderSingle(poll) {
  const form = document.createElement("form");
  for (const option of poll.options) {
    const label = document.createElement("label");
    label.className = "option";
    label.innerHTML = `<input type="radio" name="choice" value="${option.id}" required><span>${option.id}. ${option.label}</span>`;
    form.append(label);
  }
  form.append(submitButton());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const choice = new FormData(form).get("choice");
    sendVote(poll.id, { choice });
  });
  return form;
}

function renderMultiple(poll) {
  const form = document.createElement("form");
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = poll.maxSelections
    ? `Select up to ${poll.maxSelections}.`
    : "Select all that apply.";
  form.append(hint);
  for (const option of poll.options) {
    const label = document.createElement("label");
    label.className = "option";
    label.innerHTML = `<input type="checkbox" name="choices" value="${option.id}"><span>${option.id}. ${option.label}</span>`;
    form.append(label);
  }
  form.append(submitButton());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const choices = new FormData(form).getAll("choices");
    const minSelections = poll.minSelections ?? 1;
    if (choices.length < minSelections) {
      setStatus("Please select at least one option.", "error");
      return;
    }
    if (poll.maxSelections && choices.length > poll.maxSelections) {
      setStatus(`Please select at most ${poll.maxSelections} options.`, "error");
      return;
    }
    sendVote(poll.id, { choices });
  });
  return form;
}

function renderAllocation(poll) {
  const form = document.createElement("form");
  const total = document.createElement("p");
  total.className = "muted";
  const inputs = [];
  for (const option of poll.options) {
    const row = document.createElement("label");
    row.className = "number-row";
    row.innerHTML = `<span>${option.label}</span><input type="number" min="0" max="${poll.budget}" step="1" value="0" name="${option.id}">`;
    const input = row.querySelector("input");
    inputs.push(input);
    form.append(row);
  }
  function updateTotal() {
    const sum = inputs.reduce((acc, input) => acc + Number(input.value || 0), 0);
    total.textContent = `${sum} / ${poll.budget} tokens allocated`;
  }
  inputs.forEach((input) => input.addEventListener("input", updateTotal));
  updateTotal();
  form.prepend(total);
  form.append(submitButton());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = {};
    for (const input of inputs) values[input.name] = Number(input.value || 0);
    const sum = Object.values(values).reduce((acc, value) => acc + value, 0);
    if (sum > poll.budget) {
      setStatus(`You have spent ${sum}. Please spend at most ${poll.budget}.`, "error");
      return;
    }
    if (sum < poll.budget && !confirm(`You have only spent ${sum} of ${poll.budget} tokens. Submit anyway?`)) {
      return;
    }
    sendVote(poll.id, { values });
  });
  return form;
}

function renderOpen(poll) {
  const form = document.createElement("form");
  const textarea = document.createElement("textarea");
  textarea.name = "text";
  textarea.maxLength = 80;
  textarea.required = true;
  textarea.placeholder = "One or two words";
  form.append(textarea, submitButton());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendVote(poll.id, { text: textarea.value });
  });
  return form;
}

function renderQuickfire(poll) {
  const form = document.createElement("form");
  for (const question of poll.questions) {
    const row = document.createElement("div");
    row.className = "quick-row";
    const title = document.createElement("h3");
    title.textContent = question.label;
    const choices = document.createElement("div");
    choices.className = "quick-choices";
    for (const choice of poll.choices) {
      const id = `${question.id}-${choice}`;
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="${question.id}" id="${id}" value="${choice}" required> ${choice}`;
      choices.append(label);
    }
    row.append(title, choices);
    form.append(row);
  }
  form.append(submitButton());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const answers = {};
    for (const question of poll.questions) answers[question.id] = data.get(question.id);
    sendVote(poll.id, { answers });
  });
  return form;
}

async function sendVote(pollId, payload) {
  try {
    setStatus("Submitting...", "");
    await api("/api/vote", {
      method: "POST",
      body: JSON.stringify({ pollId, voterId, payload }),
    });
    setStatus("Vote received. You can change it while the poll is open.", "ok");
  } catch (error) {
    setStatus("Could not submit just now. Please try again.", "error");
  }
}

function render() {
  const poll = activePoll();
  const nextPollId = poll?.id || null;
  if (renderedPollId === nextPollId) return;
  renderedPollId = nextPollId;
  setStatus("", "");

  if (!poll) {
    titleEl.textContent = "No active poll";
    formEl.innerHTML = "";
    return;
  }
  titleEl.textContent = poll.title;
  metaEl.textContent = "";
  formEl.innerHTML = "";
  if (poll.type === "single") formEl.append(renderSingle(poll));
  if (poll.type === "multiple") formEl.append(renderMultiple(poll));
  if (poll.type === "allocation") formEl.append(renderAllocation(poll));
  if (poll.type === "open") formEl.append(renderOpen(poll));
  if (poll.type === "quickfire") formEl.append(renderQuickfire(poll));
}

async function refresh() {
  try {
    state = await api("/api/audience-state");
    render();
    if (statusEl.classList.contains("error") && /^(Connecting|Reconnecting)/.test(statusEl.textContent)) {
      setStatus("", "");
    }
  } catch (error) {
    setStatus(state ? "Reconnecting..." : "Connecting to the vote server...", "error");
  }
}

refresh();
setInterval(refresh, 4000);
