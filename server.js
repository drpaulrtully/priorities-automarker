import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ✅ Static files must live in /public
app.use(express.static("public"));

/* =========================================================
   FEthink — Prioritisation Prompting Automarker (Office Monday)
   - Access code gate -> signed httpOnly cookie session
   - Deterministic marker (no LLM calls)
   - <20 words: show only “Please add…” (no score/tags/grid/learn more/model)
   - >=20 words: full feedback + learn more + model answer available
   ========================================================= */

const ACCESS_CODE = process.env.ACCESS_CODE || "FETHINK-PRIORITY-01";
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_MINUTES = parseInt(process.env.SESSION_MINUTES || "120", 10);

const COURSE_BACK_URL = process.env.COURSE_BACK_URL || "";
const NEXT_LESSON_URL = process.env.NEXT_LESSON_URL || "";

// Signed cookie parser
app.use(cookieParser(COOKIE_SECRET));

/* ---------------- Session cookie helpers ---------------- */
const COOKIE_NAME = "fethink_comms_session"; // keep stable across clones

function setSessionCookie(res) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_MINUTES * 60;
  const payload = { exp };

  res.cookie(COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,      // Render uses HTTPS
    sameSite: "lax",
    maxAge: SESSION_MINUTES * 60 * 1000,
    signed: true
  });
}

function isSessionValid(req) {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (!raw) return false;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return typeof payload?.exp === "number" && now < payload.exp;
}

function requireSession(req, res, next) {
  if (!isSessionValid(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

/* ---------------- Helpers ---------------- */
function clampStr(s, max = 6000) {
  return String(s || "").slice(0, max);
}

function wordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function hasAny(text, needles) {
  const t = String(text || "").toLowerCase();
  return needles.some((n) => t.includes(n));
}

function countAny(text, needles) {
  const t = String(text || "").toLowerCase();
  let hits = 0;
  for (const n of needles) if (t.includes(n)) hits += 1;
  return hits;
}

/* ---------------- Task content ---------------- */
const QUESTION_TEXT =
`TASK

It’s 9:05am on a Monday. You work in an office role supporting projects, communications, and admin tasks. When you open your inbox, you find five new requests that all claim urgency, from different people across the organisation:

1) Line Manager (Operations)
Needs a summary slide deck for a leadership meeting at 2pm today. The data already exists but must be condensed into clear key messages.

2) Senior Colleague (Finance)
Asks you to review a cost spreadsheet “as soon as possible” before it is sent to an external partner. Errors could be reputationally damaging.

3) Project Lead (Delivery Team)
Messages you on Teams asking for help rewriting an email to a client who is unhappy about a delay. The tone must be professional and calming.

4) New Starter You Mentor
Emails asking for help using the internal system. They say they are blocked and can’t progress their work without guidance.

5) Your Own Deadline
You must submit your weekly report by 5pm today, and you haven’t started it yet.

You can’t do everything at once. You decide to use AI as a prioritisation assistant (you remain responsible for the final decisions).

YOUR TASK

Write a FEthink prompt using the four-stage structure:
Role → Task → Context → Format

Your prompt must instruct an AI assistant to:
- Analyse the five requests
- Weigh urgency, importance, reputational risk, and dependencies
- Propose a prioritised action plan for today
- Create a realistic, time-blocked plan for the working day
- Provide a simple decision rule for handling new tasks that arrive later
- Include 3 short reusable prompts the learner can use each Monday
- End with one reflective question to help the learner improve how they use AI to prioritise over time

OUTPUT CONSTRAINT
The AI’s response must be one page maximum (max 400 words) and practical for real office use.`;

const TEMPLATE_TEXT =
`Role:
Task:
Context (Audience):
Format:`;

/* ---------------- Model Prompt + Dummy AI Response ---------------- */
const MODEL_ANSWER =
`MODEL PROMPT (Role / Task / Context / Format)

Role: You are a workplace productivity coach who helps busy office workers prioritise competing requests under time pressure.
Task: Analyse five incoming work requests and produce a prioritised action plan for the day. Use urgency, importance, reputational risk, and dependencies to justify the order. Then propose a realistic time-blocked plan for the working day.
Context (Audience): The user is overwhelmed on a Monday morning with five competing requests: (1) leadership slides due 2pm, (2) finance spreadsheet review before sending to an external partner, (3) client email rewrite to manage disappointment and tone, (4) new starter support to unblock work, and (5) the user’s own weekly report due 5pm. The user needs a calm, structured plan and a rule for handling new requests.
Format: One-page practical plan (max 400 words) including:
- Prioritised task list with brief reasons for the order
- Time-blocked plan for the working day (morning / midday / afternoon)
- One simple decision rule for handling new tasks
- Three short reusable “Monday planning” AI prompts
- One reflective question at the end
Use clear bullet points, a supportive professional tone, and realistic assumptions.

--------------------------------------------
DUMMY AI RESPONSE (Example output)

Prioritised task order (with reasons):
1) Finance spreadsheet review — high reputational risk if errors go to an external partner; likely quick to check.
2) Leadership slide summary — fixed deadline (2pm) and senior audience; needs focused time to condense key messages.
3) Client email rewrite — tone/reputation risk; can be done efficiently with AI once key facts are clear.
4) New starter support — dependency: unblocks their work; schedule a short focused slot.
5) Weekly report — protect a block later; draft then refine.

Time-blocked plan:
09:15–09:45 Finance review
09:45–10:45 Leadership slides
11:00–11:20 Client email rewrite
11:30–11:45 New starter support
14:30–16:00 Weekly report draft

Decision rule for new tasks:
If it creates external reputational risk OR blocks others from working, assess today. Otherwise schedule or park with a clear review time.

Reusable Monday prompts:
- “Rank these tasks by urgency, impact, risk, and dependencies. Explain the trade-offs.”
- “Turn my priorities into a realistic time-block plan for today with buffers.”
- “If new tasks arrive, help me decide what to do now vs park, using my decision rule.”

Reflective question:
Which task did I feel tempted to do first — and was that urgency real, or just anxiety?`;

/* ---------------- Learn More (4 tips) ----------------
   Keys must remain: gdpr / unesco / ofsted / jisc
------------------------------------------------------- */
const FRAMEWORK = {
  gdpr: {
    expectation:
      "Force trade-offs: ask the AI to plan under constraints (e.g., ‘If I can only finish two tasks before lunch…’) so you stop over-committing.",
    case:
      "Try: “Assume I have 90 minutes before my first meeting. Which two tasks reduce the most risk and why? What gets parked?”"
  },
  unesco: {
    expectation:
      "Separate urgency from anxiety: get the AI to label what feels urgent vs what is operationally urgent (deadline/risk/dependency).",
    case:
      "Try: “Which tasks are genuinely time-critical vs emotionally noisy? Re-rank with reasons.”"
  },
  ofsted: {
    expectation:
      "Make the AI produce a decision rule: a simple ‘if/then’ that protects focus when new tasks arrive.",
    case:
      "Try: “Write a 2-line decision rule for new tasks and show 2 examples of how it applies.”"
  },
  jisc: {
    expectation:
      "Build a repeatable weekly ritual: turn prioritisation into a 5-minute Monday habit with reusable prompts and a review step.",
    case:
      "Try: “Give me 3 reusable prompts for planning, reprioritising, and reviewing each week. Keep them short.”"
  }
};

/* ---------------- Deterministic rubric targets ---------------- */
const STRUCTURE_HITS = [["role:"], ["task:"], ["context"], ["format"]];

const CRITERIA_HITS = [
  "urgency", "urgent",
  "importance", "important",
  "risk", "reputational", "reputation",
  "dependency", "dependencies", "blocked", "unblock",
  "trade-off", "tradeoffs", "constraint", "constraints"
];

const OUTPUT_REQ_HITS = {
  prioritised: ["prioritis", "priority", "rank", "order"],
  timeblock: ["time-block", "time block", "schedule", "09:", "morning", "afternoon", "time blocked", "time-blocked"],
  decisionRule: ["decision rule", "rule", "if", "then", "when new tasks", "new tasks"],
  reusablePrompts: ["reusable", "weekly prompt", "monday prompt", "prompts"],
  reflective: ["reflect", "reflection", "reflective question", "next time", "what did i learn"]
};

const CONSTRAINT_HITS = [
  "one page", "one-page", "max 400", "400 words",
  "bullet", "bullets", "supportive", "professional", "practical"
];

const SCENARIO_HITS = [
  "line manager", "operations",
  "finance", "spreadsheet", "external partner",
  "client", "delay", "tone",
  "new starter", "mentor", "blocked",
  "weekly report", "5pm",
  "2pm", "leadership", "slide"
];

/* ---------------- Status helpers ---------------- */
function statusFromLevel(level) {
  if (level >= 2) return "✓ Secure";
  if (level === 1) return "◐ Developing";
  return "✗ Missing";
}

function tagStatus(level) {
  if (level >= 2) return "ok";
  if (level === 1) return "mid";
  return "bad";
}

/* ---------------- Marker ---------------- */
function markPrioritisationPrompt(answerText) {
  const wc = wordCount(answerText);

  // ✅ HARD GATE
  if (wc < 20) {
    return {
      gated: true,
      wordCount: wc,
      message:
        "Please add to your answer.\n" +
        "This response is too short to demonstrate a complete FEthink prompt.\n" +
        "Aim for 20+ words and include Role, Task, Context, and Format.",
      score: null,
      feedback: null,
      strengths: null,
      tags: null,
      grid: null,
      framework: null,
      modelAnswer: null
    };
  }

  const t = String(answerText || "").toLowerCase();

  // Category 1: FEthink structure clarity (0–3 points)
  let structHits = 0;
  for (const hits of STRUCTURE_HITS) if (hasAny(t, hits)) structHits += 1;

  let structureLevel = 0;
  let structurePts = 0;
  const notes = [];

  if (structHits >= 4) {
    structureLevel = 2;
    structurePts = 3;
  } else if (structHits >= 2) {
    structureLevel = 1;
    structurePts = 2;
    notes.push("FEthink structure: Include all four labels (Role, Task, Context, Format) so the AI output is reliable.");
  } else {
    structureLevel = 0;
    structurePts = 1;
    notes.push("FEthink structure: Use Role, Task, Context, Format (with labels) instead of a single paragraph prompt.");
  }

  // Category 2: Prioritisation criteria (0–3 points)
  const criteriaHitCount = countAny(t, CRITERIA_HITS);
  const hasUrgency = hasAny(t, ["urgency", "urgent"]);
  const hasImportance = hasAny(t, ["importance", "important"]);
  const hasRisk = hasAny(t, ["risk", "reputational", "reputation"]);
  const hasDeps = hasAny(t, ["dependency", "dependencies", "blocked", "unblock"]);
  const families = [hasUrgency, hasImportance, hasRisk, hasDeps].filter(Boolean).length;

  let criteriaLevel = 0;
  let criteriaPts = 0;

  if (families >= 4 || (families >= 3 && criteriaHitCount >= 5)) {
    criteriaLevel = 2;
    criteriaPts = 3;
  } else if (families >= 2) {
    criteriaLevel = 1;
    criteriaPts = 2;
    notes.push("Prioritisation criteria: Explicitly instruct the AI to weigh urgency, importance, reputational risk, and dependencies (what blocks others).");
  } else {
    criteriaLevel = 0;
    criteriaPts = 1;
    notes.push("Prioritisation criteria: Don’t just ask to ‘prioritise’ — name the criteria (urgency, importance, risk, dependencies) and ask for brief justifications.");
  }

  // Category 3: Output specification completeness (0–2 points)
  const hasPrioritised = hasAny(t, OUTPUT_REQ_HITS.prioritised);
  const hasTimeblock = hasAny(t, OUTPUT_REQ_HITS.timeblock);
  const hasDecisionRule = hasAny(t, OUTPUT_REQ_HITS.decisionRule);
  const hasReusablePrompts = hasAny(t, OUTPUT_REQ_HITS.reusablePrompts) && hasAny(t, ["3", "three"]);
  const hasReflective = hasAny(t, OUTPUT_REQ_HITS.reflective);

  const outputChecks = [hasPrioritised, hasTimeblock, hasDecisionRule, hasReusablePrompts, hasReflective].filter(Boolean).length;

  let outputLevel = 0;
  let outputPts = 0;

  if (outputChecks >= 5) {
    outputLevel = 2;
    outputPts = 2;
  } else if (outputChecks >= 3) {
    outputLevel = 1;
    outputPts = 1;
    notes.push("Output spec: Require ALL components (prioritised list, time blocks, decision rule, 3 reusable prompts, reflective question).");
  } else {
    outputLevel = 0;
    outputPts = 0;
    notes.push("Output spec: Specify the exact outputs you want the AI to produce (not generic ‘tips’).");
  }

  // Category 4: Context realism + constraints (0–2 points)
  const scenarioHitCount = countAny(t, SCENARIO_HITS);
  const hasConstraints = hasAny(t, CONSTRAINT_HITS);

  let contextLevel = 0;
  let contextPts = 0;

  if (scenarioHitCount >= 5 && hasConstraints) {
    contextLevel = 2;
    contextPts = 2;
  } else if (scenarioHitCount >= 2 || hasConstraints) {
    contextLevel = 1;
    contextPts = 1;
    notes.push("Context/constraints: Anchor the AI in the Monday scenario (5 requests, deadlines, audiences) and constrain output (one page, max 400 words, bullets, tone).");
  } else {
    contextLevel = 0;
    contextPts = 0;
    notes.push("Context/constraints: Add the scenario details and output constraints so the AI produces a realistic, usable plan (not generic advice).");
  }

  // Total score out of 10
  let score = structurePts + criteriaPts + outputPts + contextPts;
  score = Math.max(0, Math.min(10, score));

  // Banding
  let band = "Vague";
  if (score >= 8) band = "Excellent";
  else if (score >= 6) band = "Good";
  else if (score >= 3) band = "Fair";

  const strengths = [];
  if (structureLevel >= 2) strengths.push("You used the FEthink structure (Role, Task, Context, Format), which improves output reliability.");
  if (criteriaLevel >= 1) strengths.push("You named prioritisation criteria (e.g., urgency and risk), pushing the AI beyond generic advice.");
  if (outputLevel >= 1) strengths.push("You specified practical outputs (e.g., time-block plan and decision rule), making the result actionable.");
  if (contextLevel >= 1) strengths.push("You anchored the scenario and constraints, which helps the AI produce a realistic one-page plan.");

  const tags = [
    { name: "Clear role definition", status: tagStatus(structureLevel) },
    { name: "Specific task instructions", status: tagStatus(criteriaLevel) },
    { name: "Context-rich prompting", status: tagStatus(contextLevel) },
    { name: "Realistic constraints", status: tagStatus(hasConstraints ? 2 : 0) },
    { name: "Actionable outputs", status: tagStatus(outputLevel) }
  ];

  // Grid IDs must not change in the front-end
  const grid = {
    ethical: statusFromLevel(criteriaLevel),         // mapped to criteria
    impact: statusFromLevel(outputLevel),            // mapped to outputs
    legal: statusFromLevel(contextLevel),            // mapped to context
    recs: statusFromLevel(hasConstraints ? 2 : 1),   // mapped to constraints
    structure: statusFromLevel(structureLevel)       // mapped to FEthink structure
  };

  const feedback =
    notes.length === 0
      ? `Strong prompt — it should produce a realistic prioritisation plan. Band: ${band} (${score}/10).`
      : `To improve (Band: ${band} • ${score}/10):\n- ` + notes.join("\n- ");

  return {
    gated: false,
    wordCount: wc,
    score,
    strengths: strengths.slice(0, 3),
    tags,
    grid,
    framework: FRAMEWORK,
    feedback,
    modelAnswer: MODEL_ANSWER
  };
}

/* ---------------- Routes ---------------- */
app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    courseBackUrl: COURSE_BACK_URL,
    nextLessonUrl: NEXT_LESSON_URL,
    questionText: QUESTION_TEXT,
    templateText: TEMPLATE_TEXT,
    targetWords: "100–250",
    minWordsGate: 20
  });
});

app.post("/api/unlock", (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ ok: false, error: "missing_code" });

  const a = Buffer.from(code);
  const b = Buffer.from(ACCESS_CODE);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "incorrect_code" });
  }

  setSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/mark", requireSession, (req, res) => {
  const answerText = clampStr(req.body?.answerText, 6000);
  const result = markPrioritisationPrompt(answerText);
  res.json({ ok: true, result });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Automarker running on http://localhost:${port}`));
