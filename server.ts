import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { registerAuthRoutes } from "./serverAuth";
import { registerCalendarRoutes } from "./serverCalendar";
import { registerBackupRoutes } from "./serverBackup";
import { registerTrainerLinkRoutes } from "./serverTrainerLinks";
import { registerMailRoutes } from "./serverMail";
import { registerDocLinkRoutes } from "./serverDocLinks";

// Load environment variables
dotenv.config();

// Never let one failed background request take the whole CRM offline.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled background error (server kept running):", reason);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Outlook email (quotations with their PDF). Registered before the general JSON reader below, because
  // a PDF is bigger than its 100 KB limit; these routes read their own bodies.
  registerMailRoutes(app);

  app.use(express.json());

  // Login and team management (passwords are checked here, on the server)
  registerAuthRoutes(app);

  // The shared Google Calendar (the server connects; nobody signs in to Google)
  registerCalendarRoutes(app);

  // Data backup: daily copy to a Google Sheet and Excel download (Admin and Management)
  registerBackupRoutes(app);

  // Trainer links: a trainer fills in a course outline or their profile without logging in
  registerTrainerLinkRoutes(app);

  // Client links: a client opens a sent quotation or course outline as a web page, without logging in
  registerDocLinkRoutes(app);

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
    // An app file that no longer exists (a tab opened before an update asks for the old one) is "not found",
    // never the CRM's home page, so the browser reports a clean failure instead of a confusing one.
    app.use("/assets", (req, res) => { res.status(404).type("text/plain").send("Not found"); });
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
