import { Route, Routes } from "react-router-dom";

import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { SystemHealthGate } from "./components/SystemHealthGate";
import { RequireAuth } from "./lib/auth";
import Copilot from "./routes/Copilot";
import Landing from "./routes/Landing";
import Researches from "./routes/Researches";
import SessionDetail from "./routes/SessionDetail";
import SignInPage from "./routes/SignInPage";
import SignUpPage from "./routes/SignUpPage";

export default function App() {
  return (
    <SystemHealthGate>
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />

        <Route
          path="/app/*"
          element={
            <RequireAuth>
              <DashboardLayout>
                <Routes>
                  <Route index element={<Copilot />} />
                  <Route path="researches" element={<Researches />} />
                  <Route path="sessions/:id" element={<SessionDetail />} />
                </Routes>
              </DashboardLayout>
            </RequireAuth>
          }
        />
      </Routes>
    </SystemHealthGate>
  );
}
