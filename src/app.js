import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";

import routes from "./routes/index.js";
import corsOptions from "./config/cors.js";
import errorMiddleware from "./middleware/error.middleware.js";
import { keepAliveService } from "./services/keepAlive.service.js";

const app = express();

app.use(helmet());

app.use(cors(corsOptions));

app.use(compression());

app.use(morgan("dev"));

app.use(express.json({ limit: "20mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "20mb",
  })
);

// Reset 12-minute idle keep-alive timer on any inbound route call
app.use((req, res, next) => {
  if (!req.headers["x-keep-alive"]) {
    keepAliveService.recordActivity(`HTTP ${req.method} ${req.path}`);
  }
  next();
});

// ==========================
// Health check / Keep-alive Ping
// ==========================

app.get(["/", "/health"], (req, res) => {
  return res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ==========================
// Routes
// ==========================

app.use("/api/v1", routes);

// ==========================
// 404 Handler
// ==========================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route Not Found",
  });
});

// ==========================
// Error Handler
// ==========================

app.use(errorMiddleware);

export default app;