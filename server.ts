import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { registerAuthRoutes } from "./serverAuth";
import { registerCalendarRoutes } from "./serverCalendar";
import { registerBackupRoutes } from "./serverBackup";

// Load environment variables
dotenv.config();

// Never let one failed background request take the whole CRM offline.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled background error (server kept running):", reason);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Login and team management (passwords are checked here, on the server)
  registerAuthRoutes(app);

  // The shared Google Calendar (the server connects; nobody signs in to Google)
  registerCalendarRoutes(app);

  // Data backup: daily copy to a Google Sheet and Excel download (Admin and Management)
  registerBackupRoutes(app);

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Vite middleware for development vs static asset serving in production
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in DEVELOPMENT mode with Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`NExt Academy Dashboard backend running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server startup failure:", err);
});
