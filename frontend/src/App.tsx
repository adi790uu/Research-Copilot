import { Route, Routes } from "react-router-dom";

import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { SystemHealthGate } from "./components/SystemHealthGate";
import { RequireAuth } from "./lib/auth";
import Chats from "./routes/Chats";
import CompanyProfile from "./routes/CompanyProfile";
import Copilot from "./routes/Copilot";
import Landing from "./routes/Landing";
import ResearchDashboard from "./routes/ResearchDashboard";
import Researches from "./routes/Researches";
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
                  <Route path="researches/:briefId" element={<ResearchDashboard />} />
                  <Route path="chats" element={<Chats />} />
                  <Route path="company" element={<CompanyProfile />} />
                </Routes>
              </DashboardLayout>
            </RequireAuth>
          }
        />
      </Routes>
    </SystemHealthGate>
  );
}
