import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The header, BTS menu and BTS pages use these too, so they load up front (not with the lazy Flowchart page),
// and before styles.css, as they always have.
import "./admin/admin.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
