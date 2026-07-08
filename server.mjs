import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const votesPath = path.join(dataDir, "votes.json");
const polls = JSON.parse(await fs.readFile(path.join(root, "polls.json"), "utf8"));
const adminToken = process.env.ADMIN_TOKEN || "";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const host = args.get("--host") || "127.0.0.1";
const port = Number(args.get("--port") || process.env.PORT || 8787);

let state = {
  activePollId: polls.polls[0]?.id || null,
  responses: {},
};

async function loadVotes() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    state = { ...state, ...JSON.parse(await fs.readFile(votesPath, "utf8")) };
  } catch {
    await saveVotes();
  }
}

async function saveVotes() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(votesPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function findPoll(id) {
  return polls.polls.find((poll) => poll.id === id);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function adminOk(req) {
  if (!adminToken) return true;
  return req.headers["x-admin-token"] === adminToken;
}

function publicPoll(poll) {
  if (!poll) return null;
  return {
    id: poll.id,
    title: poll.title,
    type: poll.type,
    budget: poll.budget,
    options: poll.options,
    choices: poll.choices,
    questions: poll.questions,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeVote(poll, payload) {
  if (poll.type === "single") {
    const optionIds = new Set(poll.options.map((option) => option.id));
    if (!optionIds.has(payload.choice)) throw new Error("Unknown option");
    return { choice: payload.choice };
  }

  if (poll.type === "allocation") {
    const optionIds = new Set(poll.options.map((option) => option.id));
    const values = {};
    let total = 0;
    for (const option of poll.options) {
      const value = Number(payload.values?.[option.id] || 0);
      if (!Number.isInteger(value) || value < 0 || value > poll.budget) throw new Error("Invalid token value");
      values[option.id] = value;
      total += value;
    }
    if (total > poll.budget) throw new Error(`Spend at most ${poll.budget}`);
    return { values };
  }

  if (poll.type === "open") {
    const text = String(payload.text || "").trim().slice(0, 80);
    if (!text) throw new Error("Text response required");
    return { text };
  }

  if (poll.type === "quickfire") {
    const questionIds = new Set(poll.questions.map((question) => question.id));
    const choices = new Set(poll.choices);
    const answers = {};
    for (const [questionId, choice] of Object.entries(payload.answers || {})) {
      if (!questionIds.has(questionId) || !choices.has(choice)) throw new Error("Invalid quick-fire answer");
      answers[questionId] = choice;
    }
    if (Object.keys(answers).length !== poll.questions.length) throw new Error("Answer every quick-fire question");
    return { answers };
  }

  throw new Error("Unsupported poll type");
}

function pollResponses(pollId) {
  return Object.values(state.responses[pollId] || {});
}

function summarize(poll) {
  const responses = pollResponses(poll.id);
  if (poll.type === "single") {
    const counts = Object.fromEntries(poll.options.map((option) => [option.id, 0]));
    for (const response of responses) counts[response.choice] = (counts[response.choice] || 0) + 1;
    return { total: responses.length, counts };
  }

  if (poll.type === "allocation") {
    const totals = Object.fromEntries(poll.options.map((option) => [option.id, 0]));
    for (const response of responses) {
      for (const [optionId, value] of Object.entries(response.values || {})) totals[optionId] += Number(value || 0);
    }
    return { total: responses.length, totals };
  }

  if (poll.type === "open") {
    const words = new Map();
    for (const response of responses) {
      for (const word of String(response.text || "").toLowerCase().match(/[a-z0-9-]+/g) || []) {
        if (word.length < 3) continue;
        words.set(word, (words.get(word) || 0) + 1);
      }
    }
    const topWords = [...words.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([word, count]) => ({ word, count }));
    return { total: responses.length, responses: responses.map((item) => item.text), topWords };
  }

  if (poll.type === "quickfire") {
    const counts = {};
    for (const question of poll.questions) {
      counts[question.id] = Object.fromEntries(poll.choices.map((choice) => [choice, 0]));
    }
    for (const response of responses) {
      for (const [questionId, choice] of Object.entries(response.answers || {})) {
        counts[questionId][choice] = (counts[questionId][choice] || 0) + 1;
      }
    }
    return { total: responses.length, counts };
  }

  return { total: responses.length };
}

async function serveFile(res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, route));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (req.method === "GET" && url.pathname === "/api/audience-state") {
    const poll = findPoll(state.activePollId);
    return json(res, 200, {
      eventTitle: polls.eventTitle,
      activePollId: state.activePollId,
      activePoll: publicPoll(poll),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/result") {
    const pollId = url.searchParams.get("pollId") || state.activePollId;
    const poll = findPoll(pollId);
    if (!poll) return json(res, 404, { error: "Unknown poll" });
    return json(res, 200, {
      eventTitle: polls.eventTitle,
      activePollId: state.activePollId,
      poll: publicPoll(poll),
      result: summarize(poll),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    if (!adminOk(req)) return json(res, 401, { error: "Presenter token required" });
    return json(res, 200, {
      eventTitle: polls.eventTitle,
      activePollId: state.activePollId,
      polls: polls.polls,
      results: Object.fromEntries(polls.polls.map((poll) => [poll.id, summarize(poll)])),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/active") {
    if (!adminOk(req)) return json(res, 401, { error: "Presenter token required" });
    const body = await readJson(req);
    if (!findPoll(body.pollId)) return json(res, 400, { error: "Unknown poll" });
    state.activePollId = body.pollId;
    await saveVotes();
    return json(res, 200, { ok: true, activePollId: state.activePollId });
  }

  if (req.method === "POST" && url.pathname === "/api/vote") {
    try {
      const body = await readJson(req);
      const poll = findPoll(body.pollId || state.activePollId);
      if (!poll) return json(res, 400, { error: "Unknown poll" });
      const voterId = String(body.voterId || "").slice(0, 80);
      if (!voterId) return json(res, 400, { error: "Missing voter" });
      const vote = sanitizeVote(poll, body.payload || {});
      state.responses[poll.id] ||= {};
      state.responses[poll.id][voterId] = { ...vote, at: new Date().toISOString() };
      await saveVotes();
      return json(res, 200, { ok: true, result: summarize(poll) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    if (!adminOk(req)) return json(res, 401, { error: "Presenter token required" });
    const body = await readJson(req);
    if (body.pollId) delete state.responses[body.pollId];
    else state.responses = {};
    await saveVotes();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

await loadVotes();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await serveFile(res, url.pathname);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Audience:  http://${host === "0.0.0.0" ? "YOUR-IP" : host}:${port}/`);
  console.log(`Presenter: http://${host === "0.0.0.0" ? "YOUR-IP" : host}:${port}/presenter.html`);
});
