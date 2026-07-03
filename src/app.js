import express from "express";
import routes from "./routes/index.js";
const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.get("/", routes);

export default app;