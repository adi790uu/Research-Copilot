import { Link, Route, Routes } from "react-router-dom";

import Home from "./routes/Home";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-800/80">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="font-medium tracking-tight text-ink-100 hover:text-white transition"
          >
            Research Copilot
          </Link>
          <span className="text-xs uppercase tracking-widest text-ink-500">
            Phase 0
          </span>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </main>

      <footer className="border-t border-ink-800/80 text-xs text-ink-500">
        <div className="mx-auto max-w-5xl px-6 py-4 flex justify-between">
          <span>research-copilot</span>
          <span>v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}
