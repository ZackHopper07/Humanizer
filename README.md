# AI Humanizer — Local Setup

Rewrite AI-generated text into natural, human-sounding prose. Powered by Claude.

---

## Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- An [Anthropic API key](https://console.anthropic.com/)

### 2. Install dependencies
```bash
npm install
```

### 3. Add your API key
Open `.env` and replace the placeholder:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
PORT=3000
```

### 4. Run the server
```bash
npm start
```

Or with auto-reload during development:
```bash
npm run dev
```

### 5. Open the app
Visit **http://localhost:3000** in your browser.

---

## Project Structure

```
humanizer/
├── server.js          ← Express server + Anthropic API calls
├── public/
│   └── index.html     ← Frontend (HTML + CSS + JS, no build step)
├── .env               ← Your API key (never commit this)
├── .gitignore
├── package.json
└── README.md
```

---

## Features

- **Split-pane editor** — original text left, humanized output right
- **Live streaming** — output appears word by word
- **Tone selector** — Casual, Academic, Professional, Gen Z, Storytelling, Friendly
- **Region/style** — Neutral, US English, UK English, Student, Nepali-English
- **AI score estimate** — heuristic detection score after rewriting
- **Readability label** — Easy / Moderate / Dense
- **Highlight new words** — toggle to see what changed
- **Copy & Export** — copy to clipboard or download as .txt

---

## Customizing the Humanization

Edit the `systemPrompt` in `server.js` to adjust how the AI rewrites text.
The tone and region maps at the top of the route are easy to extend.

---

## Next Steps (from your project outline)

- Add user authentication (Phase 2)
- Store rewrite history in MongoDB/PostgreSQL
- Add a proper AI detection score (perplexity + burstiness analysis)
- Build the pricing page and dashboard
- Add .docx file upload support
