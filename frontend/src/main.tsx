import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";

import App from "./App";
import { useTheme } from "./lib/theme";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ThemedClerkProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  if (!PUBLISHABLE_KEY) {
    return <MissingClerkKey />;
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
      afterSignOutUrl="/"
      appearance={{
        baseTheme: theme === "dark" ? dark : undefined,
        variables: {
          colorPrimary:
            theme === "dark" ? "rgb(232, 162, 107)" : "rgb(184, 102, 46)",
          colorBackground:
            theme === "dark" ? "rgb(21, 18, 14)" : "rgb(250, 246, 237)",
          colorInputBackground: "transparent",
          colorText:
            theme === "dark" ? "rgb(244, 239, 230)" : "rgb(26, 22, 20)",
          colorTextSecondary:
            theme === "dark" ? "rgb(184, 171, 156)" : "rgb(74, 63, 55)",
          colorNeutral:
            theme === "dark" ? "rgb(244, 239, 230)" : "rgb(26, 22, 20)",
          fontFamily: "'Geist', system-ui, sans-serif",
          fontFamilyButtons: "'Geist', system-ui, sans-serif",
          fontSize: "0.95rem",
          borderRadius: "2px",
        },
        elements: {
          rootBox: { width: "100%" },
          card: {
            boxShadow: "none",
            border: "1px solid rgb(var(--rule) / 0.08)",
            backgroundColor: "rgb(var(--bg-elev))",
          },
          headerTitle: {
            fontFamily: "'Fraunces', serif",
            fontStyle: "italic",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          },
          formButtonPrimary: {
            textTransform: "none",
            fontWeight: 500,
            letterSpacing: "0",
            backgroundColor: "rgb(var(--ink))",
            color: "rgb(var(--bg))",
            "&:hover": { backgroundColor: "rgb(var(--ink))", opacity: 0.92 },
          },
          socialButtonsBlockButton: {
            borderColor: "rgb(var(--rule) / 0.15)",
          },
          dividerLine: { backgroundColor: "rgb(var(--rule) / 0.1)" },
          formFieldLabel: {
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            fontSize: "0.6875rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgb(var(--ink-soft))",
          },
          formFieldInput: {
            borderRadius: "2px",
            borderColor: "rgb(var(--rule) / 0.15)",
            "&:focus": { borderColor: "rgb(var(--ink))" },
          },
          footerActionText: { color: "rgb(var(--ink-faint))" },
          footerActionLink: {
            color: "rgb(var(--accent))",
            "&:hover": { color: "rgb(var(--ink))" },
          },
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

function MissingClerkKey() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <p className="font-mono text-[0.6875rem] uppercase tracking-eyebrow text-ink-faint">
          Configuration needed
        </p>
        <h1
          className="mt-4 font-display italic text-3xl text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}
        >
          Clerk publishable key not set.
        </h1>
        <p className="mt-4 text-sm text-ink-soft leading-relaxed">
          Add <code className="font-mono text-ink">VITE_CLERK_PUBLISHABLE_KEY</code>{" "}
          to <code className="font-mono text-ink">frontend/.env</code>. You can
          grab a free dev key from{" "}
          <a
            className="underline decoration-rule/30 hover:decoration-ink"
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
          >
            dashboard.clerk.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemedClerkProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ThemedClerkProvider>
    </BrowserRouter>
  </React.StrictMode>
);
