import { createRoot } from "react-dom/client";
import { installReplay, type Recordings } from "./engine";
import { useLocation } from "./router";
import Welcome from "@/components/Welcome";
import ProjectPicker from "@/components/ProjectPicker";
import ResurrectRoute from "@/components/ResurrectRoute";
import ReportRoute from "@/components/ReportRoute";

const data = JSON.parse(document.getElementById("recordings")!.textContent || "{}") as Recordings;
installReplay(data);

function App() {
  const { path } = useLocation();
  if (path === "/projects") return <ProjectPicker />;
  if (path === "/resurrect") return <ResurrectRoute />;
  if (path === "/report") return <ReportRoute />;
  return <Welcome />;
}

createRoot(document.getElementById("root")!).render(<App />);
