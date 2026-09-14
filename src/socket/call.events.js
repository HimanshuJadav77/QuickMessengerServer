import pkg from "agora-token";
const { RtcTokenBuilder, RtcRole } = pkg;
import { broadcastToUser, userHasSockets } from "./users.manager.js";
import { sendFCMToUser } from "./fcm.service.js";

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

let currentMonthKey = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
let monthlyUsageSeconds = 0;
const MAX_MONTHLY_SECONDS = 10000 * 60; // 10,000 minutes = 600,000 seconds

export const getNextResetDate = () => {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString().split("T")[0]; // "YYYY-MM-01"
};

export const checkMonthlyQuota = () => {
  const nowKey = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
  if (nowKey !== currentMonthKey) {
    currentMonthKey = nowKey;
    monthlyUsageSeconds = 0;
  }
  return monthlyUsageSeconds < MAX_MONTHLY_SECONDS;
};

export const generateAgoraToken = (channelName, uid = 0) => {
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    throw new Error("AGORA_APP_ID and AGORA_APP_CERTIFICATE environment variables are required.");
  }
  const role = RtcRole.PUBLISHER;
  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  return RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    role,
    privilegeExpiredTs,
    privilegeExpiredTs
  );
};

export const handleCallOffer = async (socket, data) => {
  const callerId = socket.user?.uid;
  const { receiverId } = data;

  if (!checkMonthlyQuota()) {
    const nextDate = getNextResetDate();
    socket.emit("call_error", {
      code: "QUOTA_EXCEEDED",
      message: `Calling service is not available until ${nextDate}.`,
      nextAvailableDate: nextDate,
    });
    return;
  }

  if (!receiverId) {
    socket.emit("call_error", { message: "receiverId is required" });
    return;
  }

  const channelId = data.channelId || `call_${callerId}_${Date.now()}`;
  const token = generateAgoraToken(channelId, 0);

  const callData = {
    ...data,
    callerId,
    channelId,
    token,
    appId: AGORA_APP_ID,
  };

  const isOnline = userHasSockets(receiverId);
  if (isOnline) {
    broadcastToUser(receiverId, "call_offer", callData);
  }

  // Send high-priority FCM wakeup so recipient gets alerted even if offline, backgrounded, or phone locked
  try {
    await sendFCMToUser(receiverId, {
      type: "incoming_call",
      title: "Incoming Call",
      body: `${data.callerName || "Someone"} is calling...`,
      callId: data.callId || channelId,
      callerId,
      callerName: data.callerName || "Someone",
      callerImageUrl: data.callerAvatar || "",
      channelId,
      callType: data.callType || "audio",
      token,
      appId: AGORA_APP_ID,
    });
  } catch (err) {
    console.warn("[CallEvents] Failed to send call FCM wakeup:", err.message);
  }

  socket.emit("call_token_ready", callData);
};

export const handleCallAnswer = (socket, data) => {
  const receiverId = socket.user?.uid;
  const { callerId, channelId } = data;

  if (!callerId) {
    socket.emit("call_error", { message: "callerId is required" });
    return;
  }

  if (!userHasSockets(callerId)) {
    socket.emit("call_error", { message: "Caller is no longer connected.", code: "CALLER_OFFLINE" });
    return;
  }

  const token = (channelId && !data.token) ? generateAgoraToken(channelId, 0) : data.token;

  broadcastToUser(callerId, "call_answer", {
    ...data,
    receiverId,
    token,
    appId: AGORA_APP_ID,
  });
};

export const handleCallRejected = (socket, data) => {
  const receiverId = socket.user?.uid;
  const { callerId } = data;

  if (!callerId) return;

  broadcastToUser(callerId, "call_rejected", { ...data, receiverId });
};

export const handleCallEnded = (socket, data) => {
  const userId = socket.user?.uid;
  const otherUserId = data.otherUserId || data.callerId || data.receiverId;

  if (data.durationSeconds) {
    monthlyUsageSeconds += Number(data.durationSeconds);
  }

  if (!otherUserId) return;

  broadcastToUser(otherUserId, "call_ended", { ...data, endedBy: userId });
};

export const handleGetAgoraToken = (socket, data) => {
  if (!checkMonthlyQuota()) {
    const nextDate = getNextResetDate();
    socket.emit("agora_token_response", {
      error: "QUOTA_EXCEEDED",
      message: `Calling service is not available until ${nextDate}.`,
      nextAvailableDate: nextDate,
    });
    return;
  }
  const { channelId } = data || {};
  if (!channelId) {
    socket.emit("agora_token_response", { error: "channelId required" });
    return;
  }
  const token = generateAgoraToken(channelId, 0);
  socket.emit("agora_token_response", { channelId, token, appId: AGORA_APP_ID });
};
