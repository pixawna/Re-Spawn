import { createRoot } from "react-dom/client";
import { installReplay, type Recordings } from "./engine";
import ReSpawn from "@/components/ReSpawn";

const data = JSON.parse(document.getElementById("recordings")!.textContent || "{}") as Recordings;
installReplay(data);
createRoot(document.getElementById("root")!).render(<ReSpawn />);
