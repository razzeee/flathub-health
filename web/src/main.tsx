import { hydrateRoot, createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import type { PageData } from "./data.ts";
import "./style.css";

// This JSON is validated and escaped by the build, not fetched from an API.
const data: PageData = JSON.parse(
  document.getElementById("page-data")!.textContent!,
);
const root = document.getElementById("root")!;
if (root.querySelector("header")) hydrateRoot(root, <App data={data} />);
else createRoot(root).render(<App data={data} />);
