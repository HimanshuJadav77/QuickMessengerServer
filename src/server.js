import dotnev from "dotenv";
import http from "http";
import app from "./app.js";

dotnev.config()

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT,()=>{
    console.log("💻Server Running..");
    console.log(`🌐http://localhost:${PORT}`);
});