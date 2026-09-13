import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import UsernameService from "../services/username.service.js";

const router = Router();

router.get("/check-availability", async (req, res) => {
  try {
    const { username } = req.query;
    const result = await UsernameService.isAvailable(username);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/update", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.uid;
    const { username } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await UsernameService.updateUsername(userId, username);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
