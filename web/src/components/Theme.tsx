import { useEffect, useState } from "react";

export function Theme() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "system");
  }, []);
  return (
    <label className="theme-control">
      <span>Appearance</span>
      <select
        aria-label="Appearance"
        value={theme}
        onChange={(event) => {
          const value = event.target.value;
          setTheme(value);
          document.documentElement.dataset.theme = value;
          try {
            localStorage.setItem("health-theme", value);
          } catch {
            /* Storage is optional. */
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
