import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";

import routes from "./routes/index.js";
import corsOptions from "./config/cors.js";
import errorMiddleware from "./middleware/error.middleware.js";

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