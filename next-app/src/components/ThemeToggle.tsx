"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light") {
      setLight(true);
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggle = () => {
    setLight((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("light");
        localStorage.setItem("theme", "light");
      } else {
        document.documentElement.classList.remove("light");
        localStorage.setItem("theme", "dark");
      }
      // Trigger canvas redraw by dispatching a resize event
      window.dispatchEvent(new Event("resize"));
      return next;
    });
  };

  return (
    <button
      onClick={toggle}
      className="rounded-full px-2 py-1 text-xs transition-colors"
      style={{
        background: "var(--ctp-surface0)",
        color: "var(--ctp-subtext1)",
      }}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
    >
      {light ? "Dark" : "Light"}
    </button>
  );
}
