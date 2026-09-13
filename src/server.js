import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { initializeSocket } from "./socket/index.js";
import { keepAliveService } from "./services/keepAlive.service.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

initializeSocket(server);

server.listen(PORT, () => {
    console.log("=======================================");
    console.log("🚀 Quick Messenger Server Started");
    console.log(`🌍 Environment : ${process.env.NODE_ENV}`);
    console.log(`📡 Port        : ${PORT}`);
    console.log(`🔗 URL         : http://localhost:${PORT}`);
    console.log("=======================================");

    // Start 12-minute idle keep-alive monitor
    keepAliveService.start();
});