import { Router } from "express";
import authMiddleware from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Quick Messenger Server Running",
        version: "v1.0.0",
    });
});

router.get("/test-log", (req, res) => {

    console.info("Info Log");

    console.warn("Warning Log");

    console.error("Error Log");

    return res.json({
        success: true,
    });

});

router.get("/error", (req, res, next) => {

    const error = new Error("Testing Error Middleware");

    error.statusCode = 400;

    next(error);

});
router.get("/profile", authMiddleware, (req, res) => {
    return res.json({
        success: true,
        user: req.user,
    });
});

export default router;