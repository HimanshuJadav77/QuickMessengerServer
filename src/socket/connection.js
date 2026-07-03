import { Socket } from "socket.io";

const registerConnectionHandler = (io) => {
    io.on("connection", (socket) => {
        console.info(`Socket Connected ${socket.id}`);

        socket.on("disconnect", (reason) => {
            console.info(`Socket Disconnected ${socket.id}`);
            console.info(`Reason ${reason}`);
        });
    })
};
export default registerConnectionHandler;