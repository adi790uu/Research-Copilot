import { Route, Routes } from "react-router-dom";
import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";

import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import Dashboard from "./routes/Dashboard";
import Landing from "./routes/Landing";
import SessionDetail from "./routes/SessionDetail";
import SignInPage from "./routes/SignInPage";
import SignUpPage from "./routes/SignUpPage";

export default function App() {
  return (
    <Routes>
      {/* Public marketing surface */}
      <Route path="/" element={<Landing />} />

      {/* Auth — catch-all so Clerk can handle nested routes (sso callback, verify, etc.) */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* Dashboard — gated */}
      <Route
        path="/app/*"
        element={
          <>
            <SignedIn>
              <DashboardLayout>
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="sessions/:id" element={<SessionDetail />} />
                </Routes>
              </DashboardLayout>
            </SignedIn>
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          </>
        }
      />
    </Routes>
  );
}
