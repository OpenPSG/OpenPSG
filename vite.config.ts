import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";

function getGitVersion() {
  let version = "";
  try {
    version = execSync("git describe --tags --abbrev=0").toString().trim();
  } catch {
    version = execSync("git rev-parse --short HEAD").toString().trim();
  }

  // Check for uncommitted changes
  const isDirty = !!execSync("git status --porcelain").toString().trim();
  if (isDirty) {
    version += "-dirty";
  }

  return version;
}

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_BUILD_VERSION": JSON.stringify(getGitVersion()),
    },
  };
});
