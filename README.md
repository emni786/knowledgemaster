# 🧠 KnowledgeMaster

A modern, full-stack knowledge management application that helps you organize, discover, and analyze your knowledge base — all in one place.

---

## ✨ Features

- 📚 **Library** — Store and manage all your knowledge items in one organized place
- 🔍 **Discover** — Explore and find new content across your knowledge base
- 📊 **Analytics** — Visualize your knowledge graph with interactive 2D/3D force graphs
- 📋 **Digest** — Get summarized digests of your saved content
- 🏠 **Dashboard** — Get a bird's-eye view of everything at a glance
- ⚙️ **Settings** — Customize your experience
- 🔐 **Authentication** — Secure login, signup & password reset via Supabase Auth

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| **Frontend** | React 19, TypeScript |
| **Routing** | TanStack Router / TanStack Start |
| **Styling** | Tailwind CSS v4, Radix UI |
| **State / Data** | TanStack Query |
| **Backend / Auth** | Supabase |
| **3D Visualization** | Three.js, React Force Graph (2D & 3D) |
| **Build Tool** | Vite 7 |
| **Package Manager** | Bun |
| **Deployment** | Cloudflare Workers |

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed
- A [Supabase](https://supabase.com/) project set up

### Installation

```bash
# Clone the repository
git clone https://github.com/emni786/knowledgemaster.git
cd knowledgemaster

# Install dependencies
bun install
```

### Environment Variables

Create a `.env` file in the root directory and add your Supabase credentials:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Run Locally

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Available Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start development server |
| `bun run build` | Build for production |
| `bun run build:dev` | Build in development mode |
| `bun run preview` | Preview the production build |
| `bun run lint` | Run ESLint |
| `bun run format` | Format code with Prettier |

---

## 📁 Project Structure

```
knowledgemaster/
├── src/
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── integrations/      # External service integrations
│   ├── lib/               # Utility functions
│   ├── routes/            # TanStack Router pages
│   │   ├── _authenticated/
│   │   │   ├── dashboard.tsx
│   │   │   ├── library.tsx
│   │   │   ├── analytics.tsx
│   │   │   ├── digest.tsx
│   │   │   ├── discover.tsx
│   │   │   └── settings.tsx
│   │   ├── auth.tsx
│   │   └── reset-password.tsx
│   ├── server.ts          # Server entry
│   └── styles.css         # Global styles
├── supabase/              # Supabase config & migrations
├── extension/             # Browser extension
├── public/                # Static assets
└── vite.config.ts
```

---

## ☁️ Deployment

This project is configured for **Cloudflare Workers** deployment via `wrangler.jsonc`.

```bash
# Build and deploy
bun run build
npx wrangler deploy
```

---

## 📄 License

This project is private. All rights reserved.

---

> Built with ❤️ using React, TanStack, and Supabase.
