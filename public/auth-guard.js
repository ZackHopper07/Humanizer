// ─────────────────────────────────────────────
// auth-guard.js
// Include this in your index.html AFTER firebase-config.js
// It protects the page and handles token injection + usage display
// ─────────────────────────────────────────────

let currentUser = null;

// Redirect to login if not authenticated
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  currentUser = user;
  initUserUI(user);
  await loadUsage();
});

// Build the auth header for API calls
async function getAuthHeader() {
  if (!currentUser) throw new Error("Not logged in");
  const token = await currentUser.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

// Load and display today's usage
async function loadUsage() {
  try {
    const headers = await getAuthHeader();
    const res = await fetch('/api/usage', { headers });
    const data = await res.json();
    updateUsageUI(data);
  } catch (err) {
    console.error('Failed to load usage:', err);
  }
}

// Update the usage bar in the UI
function updateUsageUI(data) {
  const { wordsUsed, wordsRemaining, dailyLimit } = data;
  const pct = Math.min(100, (wordsUsed / dailyLimit) * 100);

  const barFill = document.getElementById('usageBarFill');
  const usageText = document.getElementById('usageText');
  const usageSub = document.getElementById('usageSub');

  if (barFill) {
    barFill.style.width = pct + '%';
    // Color shifts: green → yellow → red
    if (pct < 60) barFill.style.background = 'var(--accent)';
    else if (pct < 85) barFill.style.background = '#ffaa6b';
    else barFill.style.background = '#ff6b6b';
  }

  if (usageText) usageText.textContent = `${wordsUsed.toLocaleString()} / ${dailyLimit.toLocaleString()} words used today`;
  if (usageSub) usageSub.textContent = `${wordsRemaining.toLocaleString()} words remaining — resets at UTC midnight`;
}

// Show user email + logout button in UI
function initUserUI(user) {
  const emailEl = document.getElementById('userEmail');
  if (emailEl) emailEl.textContent = user.email;
}

// Logout
function logout() {
  auth.signOut().then(() => {
    window.location.href = '/login.html';
  });
}

// ─────────────────────────────────────────────
// MAIN HUMANIZE CALL — replaces your old fetch
// Drop this into your index.html's humanize function
// ─────────────────────────────────────────────
async function humanizeText(text, tone, region) {
  const authHeaders = await getAuthHeader();

  const res = await fetch('/api/humanize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ text, tone, region }),
  });

  const data = await res.json();

  if (!res.ok) {
    // Handle limit error specifically
    if (res.status === 429) {
      updateUsageUI({
        wordsUsed: data.wordsUsed,
        wordsRemaining: data.wordsRemaining,
        dailyLimit: data.dailyLimit,
      });
      throw new Error(data.error);
    }
    throw new Error(data.error || 'Something went wrong.');
  }

  // Update usage display after successful call
  if (data.usage) updateUsageUI(data.usage);

  return data.output;
}
