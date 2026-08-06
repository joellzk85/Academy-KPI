import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

let aiClient: GoogleGenAI | null = null;

// Lazy initialization of Gemini client as per rules
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not defined.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Academic Co-Pilot Endpoint (Gemini Integration)
  app.post("/api/copilot", async (req, res) => {
    try {
      const { messages, datasetContext } = req.body;
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "Invalid request payload. 'messages' array is required." });
        return;
      }

      const client = getGeminiClient();

      // Format current history for Gemini
      const conversationHistory = messages.map((m: { role: string; text: string }) => {
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`;
      }).join("\n");

      const latestMessage = messages[messages.length - 1]?.text || "";

      // Provide robust system instructions & contextual dataset about NEXT Academy
      const systemInstruction = `
You are the NExt Academy Sales & Operations AI Co-Pilot, an expert CRM strategist and growth advisor for NEXT Academy operations in Malaysia.
Your role is to assist program managers, directors, and representatives in analyzing sales pipeline performance, weekly representative KPIs (calls, proposals, appointments, closing units, closed RM, 1-on-1 coaching), commission metrics, venue schedules, and trainer/facilitator assignments.

Here is the current team roster and operational database for context:
${JSON.stringify(datasetContext || {}, null, 2)}

Operational context about NEXT Academy:
- Located in Kuala Lumpur, Malaysia. They teach intensive high-growth courses and host educational programs.
- The Sales & Ops team actively monitors weekly metrics for Sales Representatives (Xin Ying, Chee Cai, Alif, Atiqa, etc.).
- Critical KPIs include: Calls (target 150-220/mo), Proposals (target 80-130/mo), Appointments (target 15-30/mo), Closing Units (target 5-12/mo), Closing RM (target RM 150k-350k/mo).
- We also track Venue bookings, Trainer/Facilitator allocations, and Quotations.

Guidelines for your responses:
1. Provide extremely practical, strategic advice to boost sales pipeline conversions (e.g. improving Appointment to Closing ratios).
2. If asked to write outreach emails, proposal templates, or motivational messages to reps, write a polished, professional, and copy-pasteable template.
3. Keep your advice structured with clear markdown headers, bold key terms, and concise bullet points.
4. Keep the tone professional, objective, encouraging, and highly business-focused. Avoid excessive preamble or repetitive greetings.
`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `${conversationHistory}\n\nAssistant:`,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({ response: response.text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ 
        error: "Failed to generate response from Gemini Academic Co-Pilot.",
        details: error.message || "Unknown error"
      });
    }
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
