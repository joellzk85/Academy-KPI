import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { registerAuthRoutes } from "./serverAuth";
import { registerCalendarRoutes } from "./serverCalendar";
import { registerBackupRoutes } from "./serverBackup";
import { registerRestoreRoutes } from "./serverRestore";
import { registerTrainerLinkRoutes } from "./serverTrainerLinks";
import { registerMailRoutes } from "./serverMail";
import { registerTrainerPortalRoutes } from "./serverTrainerPortal";
import { registerTrainerDocRoutes } from "./serverTrainerDocs";
import { registerDocLinkRoutes } from "./serverDocLinks";
import { registerReportCheckinRoutes } from "./serverReportCheckin";
import { registerPhotoRoutes } from "./serverPhotos";
import { registerProposalLinkRoutes } from "./serverProposalLinks";
import { registerLinkVisitRoutes } from "./serverLinkVisits";
import { registerPaymentLinkRoutes } from "./serverPaymentLinks";
import { registerReferrerRoutes } from "./serverReferrers";
import { registerBlueprintRoutes } from "./serverBlueprint";
import { registerKpiRoutes } from "./serverKpi";
import { registerOneToOneRoutes } from "./serverOneToOne";
import { registerActivityRoutes } from "./serverActivity";
import { registerAccountsPortalRoutes, registerAccountsSlipRoute } from "./serverAccountsPortal";

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

  // Import from the Blueprint spreadsheet (Management): reads the Excel file, also bigger than 100 KB.
  registerBlueprintRoutes(app);

  // Accounts portal: the bank slip upload (a file, bigger than 100 KB).
  registerAccountsSlipRoute(app);

  app.use(express.json());

  // Login and team management (passwords are checked here, on the server)
  registerAuthRoutes(app);

  // The shared Google Calendar (the server connects; nobody signs in to Google)
  registerCalendarRoutes(app);

  // Data backup: daily copy to a Google Sheet and Excel download (owner only since 2026-10-24)
  registerBackupRoutes(app);
  // Saved daily copies and restore (owner only, 2026-10-24)
  registerRestoreRoutes(app);

  // Trainer links: a trainer fills in a course outline or their profile without logging in
  registerTrainerLinkRoutes(app);

  // Client links: a client opens a sent quotation or course outline as a web page, without logging in
  registerDocLinkRoutes(app);
  // The HOD's 30-day check-in on a training report (/c/<token>, 2026-10-27).
  registerReportCheckinRoutes(app);

  // Trainer portal (/trainer): trainers with access log in by email; Admin and Management give access
  registerTrainerPortalRoutes(app);
  registerTrainerDocRoutes(app);

  // Teambuilding proposal links: the client's page (/p/<token>), visit tracking and "Accept proposal"
  registerProposalLinkRoutes(app);

  // Client link tracking (every link kind) and the heatmap's copy of the document (Management)
  registerLinkVisitRoutes(app);

  // Payment links for accounts: open a payment request without logging in and click "Payment made" (/pay/<token>)
  registerPaymentLinkRoutes(app);
  // Accounts portal (/accounts, 2026-10-28): accounts staff pay approved payments; Management views and manages it
  registerAccountsPortalRoutes(app);

  // Referrers: their own link for bank details (/ref/<token>), accepting it, and the referral fee raised when a deal is won
  registerReferrerRoutes(app);

  // Photos for the teambuilding proposal PDF (read by the server, so the PDF can include them)
  registerPhotoRoutes(app);

  // Gross profit KPIs: the GP % only, worked out from the P&L (reps and Admin can't read costs)
  registerKpiRoutes(app);
  registerOneToOneRoutes(app);

  // Logins and sensitive actions for Team → Login log (Management only; IP, place, device, warning flags)
  registerActivityRoutes(app);

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
