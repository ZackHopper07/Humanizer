require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const { humanizeLegacy } = require("./lib/legacy-pipeline");
const { humanize } = require("./lib/pipeline");

// PIPELINE=legacy in .env switches back to the old pipeline
const runPipeline = process.env.PIPELINE === "legacy" ? humanizeLegacy : humanize;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// Firebase Admin Init
// ─────────────────────────────────────────────
function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
    } catch (err) {
      console.warn('FIREBASE_SERVICE_ACCOUNT is invalid, falling back to local file.');
    }
  }

  const candidates = [
    path.join(__dirname, 'ai-humanizer-b1377-firebase-adminsdk-fbsvc-0dc018ac9f.json'),
    path.join(__dirname, 'serviceAccount.json'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.warn(`Failed to read Firebase service account file: ${filePath}`);
      }
    }
  }

  return null;
}

const serviceAccount = loadServiceAccount();

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('Firebase Admin initialized successfully.');
} else {
  console.warn('Firebase Admin credentials not found. Running without Admin SDK. Usage and AI endpoints will be unavailable until configured.');
}

const db = serviceAccount ? admin.firestore() : null;

// ─────────────────────────────────────────────
// Admin accounts — no word limit
// ─────────────────────────────────────────────
const ADMIN_EMAILS = ["shresthavinit@gmail.com"];

// ─────────────────────────────────────────────
// Auth Middleware
// ─────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated. Please log in." });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

// ─────────────────────────────────────────────
// Word Limit Logic
// ─────────────────────────────────────────────
const DAILY_WORD_LIMIT = 1000;

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function checkAndUpdateWordCount(uid, wordsToAdd) {
  const todayKey = getTodayKey();
  const docRef = db.collection("usage").doc(uid);
  return await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    const data = doc.exists ? doc.data() : {};
    const currentDay = data.day === todayKey ? data.wordsUsed || 0 : 0;
    const newTotal = currentDay + wordsToAdd;
    if (newTotal > DAILY_WORD_LIMIT) {
      return { allowed: false, wordsUsed: currentDay, wordsRemaining: DAILY_WORD_LIMIT - currentDay };
    }
    tx.set(docRef, { day: todayKey, wordsUsed: newTotal }, { merge: false });
    return { allowed: true, wordsUsed: newTotal, wordsRemaining: DAILY_WORD_LIMIT - newTotal };
  });
}

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

app.get("/api/test", (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  res.json({
    ok: !!key && key !== "your_api_key_here",
    message: key ? `Key loaded: ${key.slice(0, 14)}...` : "No API key set",
  });
});

app.post("/api/premium/checkout", async (req, res) => {
  const { plan, customerName, customerEmail, cardLast4 } = req.body || {};

  if (plan !== "pro") {
    return res.status(400).json({ error: "Unsupported plan." });
  }

  if (!customerName || !customerEmail || !cardLast4) {
    return res.status(400).json({ error: "Please provide a valid payment payload." });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePriceId = process.env.STRIPE_PRICE_ID;

  if (stripeSecretKey && stripePriceId) {
    try {
      const params = new URLSearchParams({
        mode: 'subscription',
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?checkout=success`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/premium.html?checkout=cancel`,
        'line_items[0][price]': stripePriceId,
        'line_items[0][quantity]': '1',
        customer_email: customerEmail,
      });

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const stripeData = await response.json();
      if (!response.ok) {
        throw new Error(stripeData.error?.message || 'Stripe checkout failed');
      }

      return res.json({ ok: true, checkoutUrl: stripeData.url, message: 'Checkout session created.' });
    } catch (err) {
      console.error('Stripe checkout error:', err);
      return res.status(502).json({ error: 'Stripe checkout could not be created.' });
    }
  }

  return res.json({
    ok: true,
    mock: true,
    message: `Pro access enabled for ${customerEmail} using the secure demo checkout gateway.`,
  });
});

app.get("/api/usage", requireAuth, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: "Usage tracking is unavailable until Firebase Admin is configured." });
    }

    if (ADMIN_EMAILS.includes(req.user.email)) {
      return res.json({
        wordsUsed: 0, wordsRemaining: 999999,
        dailyLimit: 999999, resetsAt: "never — admin account", isAdmin: true,
      });
    }
    const todayKey = getTodayKey();
    const docRef = db.collection("usage").doc(req.user.uid);
    const doc = await docRef.get();
    const data = doc.exists ? doc.data() : {};
    const wordsUsed = data.day === todayKey ? data.wordsUsed || 0 : 0;
    res.json({
      wordsUsed,
      wordsRemaining: Math.max(0, DAILY_WORD_LIMIT - wordsUsed),
      dailyLimit: DAILY_WORD_LIMIT,
      resetsAt: "UTC midnight",
      isAdmin: false,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch usage." });
  }
});

app.post("/api/humanize", requireAuth, async (req, res) => {
  const { text, tone, region } = req.body;

  if (!text || !text.trim()) return res.status(400).json({ error: "No text provided." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    return res.status(500).json({ error: "API key not configured." });
  }

  const wordCount = countWords(text);
  const isAdmin = ADMIN_EMAILS.includes(req.user.email);

  let limitCheck = { allowed: true, wordsUsed: 0, wordsRemaining: 999999 };
  if (!isAdmin) {
    if (!db) {
      return res.status(503).json({ error: "Usage tracking is unavailable until Firebase Admin is configured." });
    }
    limitCheck = await checkAndUpdateWordCount(req.user.uid, wordCount);
  }

  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: `Daily limit reached. You've used ${limitCheck.wordsUsed}/${DAILY_WORD_LIMIT} words today. Resets at UTC midnight.`,
      wordsUsed: limitCheck.wordsUsed,
      wordsRemaining: limitCheck.wordsRemaining,
      dailyLimit: DAILY_WORD_LIMIT,
    });
  }

  try {
    const result = await runPipeline({ apiKey, text, tone, region });
    res.json({
      output: result.output,
      isAdmin,
      analysis: result.analysis,
      usage: {
        wordsUsed: limitCheck.wordsUsed,
        wordsRemaining: limitCheck.wordsRemaining,
        dailyLimit: isAdmin ? 999999 : DAILY_WORD_LIMIT,
      },
    });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Catch-all — serve index.html
// ─────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Running at http://localhost:${PORT}\n`);
});