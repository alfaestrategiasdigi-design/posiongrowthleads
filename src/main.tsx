import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
