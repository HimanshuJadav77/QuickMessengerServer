import { Server } from "socket.io";
import registerConnectionHandler from "./connection.js"

let io = null;

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] },
        transports: ["websocket"],
        pingInterval: 25000,
        pingTimeout: 60000
    });
    registerConnectionHandler(io);
    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.IO is not initialized.");
    }
    return io;
};

export { initializeSocket, getIO };