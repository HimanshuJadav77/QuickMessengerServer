import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import usernameRoutes from "./username.routes.js";

const router = Router();

router.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Quick Messenger Server Running",
    version: "v1.0.0",
  });
});

router.use("/username", usernameRoutes);

router.get("/profile", authMiddleware, (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
});

export default router;