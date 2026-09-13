import { auth } from "../config/firebase.js";
import { addUserSocket, removeUserSocket, getUserSocketCount, setActiveConversation } from "./users.manager.js";
import {
  handleSendMessage,
  handleEditMessage,
  handleToggleReaction,
  handleMessageDelivered,
  handleMarkRead,
  handleDeleteForMe,
  handleDeleteForEveryone,
  handleTypingStart,
  handleTypingStop,
} from "./chat.events.js";
import {
  handleCreateGroup,
  handleSendGroupMessage,
  handleGroupTypingStart,
  handleGroupTypingStop,
} from "./group.events.js";
import {
  handleCallOffer,
  handleCallAnswer,
  handleCallRejected,
  handleCallEnded,
  handleGetAgoraToken,
} from "./call.events.js";
import { keepAliveService } from "../services/keepAlive.service.js";

const registerConnectionHandler = (io) => {
  // Socket Auth Middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication error: token missing"));
      }

      const decodedToken = await auth.verifyIdToken(token);
      socket.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
      };

      next();
    } catch (error) {
      console.error("Socket authentication failed:", error.message);
      return next(new Error("Authentication error: invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user.uid;
    addUserSocket(userId, socket);
    console.info(`✅ Socket Authenticated & Connected: socket.id=${socket.id}, uid=${userId} (Total sockets for user: ${getUserSocketCount(userId)})`);

    // Reset 12-minute keep-alive timer on socket connection and incoming events
    keepAliveService.recordActivity(`socket:connect:${userId}`);
    socket.onAny((event) => {
      keepAliveService.recordActivity(`socket:${event}`);
    });

    // Active conversation tracking
    socket.on("set_active_conversation", (data) => {
      const { conversationId } = data || {};
      setActiveConversation(socket, conversationId || null);
      console.info(`📌 Active conversation set for socket ${socket.id} (uid: ${userId}): ${conversationId || 'none'}`);
    });

    // Bind 1-on-1 chat event handlers
    socket.on("send_message", (data) => handleSendMessage(socket, data));
    socket.on("edit_message", (data) => handleEditMessage(socket, data));
    socket.on("toggle_reaction", (data) => handleToggleReaction(socket, data));
    socket.on("message_delivered", (data) => handleMessageDelivered(socket, data));
    socket.on("mark_read", (data) => handleMarkRead(socket, data));
    socket.on("delete_message_for_me", (data) => handleDeleteForMe(socket, data));
    socket.on("delete_message_for_everyone", (data) => handleDeleteForEveryone(socket, data));
    socket.on("typing_start", (data) => handleTypingStart(socket, data));
    socket.on("typing_stop", (data) => handleTypingStop(socket, data));
    socket.on("sync_messages", (data) => handleSyncMessages(socket, data));

    // Bind Group Chat event handlers
    socket.on("create_group", (data) => handleCreateGroup(socket, data));
    socket.on("send_group_message", (data) => handleSendGroupMessage(socket, data));
    socket.on("group_typing_start", (data) => handleGroupTypingStart(socket, data));
    socket.on("group_typing_stop", (data) => handleGroupTypingStop(socket, data));

    // Bind Voice & Video Call event handlers
    socket.on("call_offer", (data) => handleCallOffer(socket, data));
    socket.on("call_answer", (data) => handleCallAnswer(socket, data));
    socket.on("call_rejected", (data) => handleCallRejected(socket, data));
    socket.on("call_ended", (data) => handleCallEnded(socket, data));
    socket.on("get_agora_token", (data) => handleGetAgoraToken(socket, data));

    socket.on("disconnect", (reason) => {
      removeUserSocket(userId, socket);
      console.info(`❌ Socket Disconnected: socket.id=${socket.id}, uid=${userId}, reason=${reason} (Remaining sockets: ${getUserSocketCount(userId)})`);
    });
  });
};

export default registerConnectionHandler;