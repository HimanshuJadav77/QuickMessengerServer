import { db, messaging } from "../config/firebase.js";

/**
 * Send FCM notification to all active device tokens of a user
 * Supports multi-device token sets and automatically removes invalid/expired tokens.
 */
export const sendFCMToUser = async (userId, payload) => {
  try {
    const userDoc = await db.collection("Users").doc(userId).get();

    if (!userDoc.exists) {
      console.info(`User ${userId} not found in Firestore for FCM`);
      return false;
    }

    const data = userDoc.data();
    const rawTokens = data.fcmToken;
    let fcmTokens = [];

    if (Array.isArray(rawTokens)) {
      fcmTokens = rawTokens.filter((t) => typeof t === "string" && t.trim().length > 0);
    } else if (typeof rawTokens === "string" && rawTokens.trim().length > 0) {
      fcmTokens = [rawTokens.trim()];
    }

    if (fcmTokens.length === 0) {
      console.info(`User ${userId} has no registered FCM tokens`);
      return false;
    }

    // Fetch Sender profile details for rich notification header & deep navigation
    let senderName = payload.senderName || "New Message";
    let senderAvatarUrl = payload.senderAvatarUrl || "";
    let senderAbout = "";
    let senderEmail = "";

    if (payload.senderId) {
      try {
        const senderDoc = await db.collection("Users").doc(payload.senderId).get();
        if (senderDoc.exists) {
          const sData = senderDoc.data();
          senderName = sData.username || sData.name || senderName;
          senderAvatarUrl = sData.userimageurl || sData.imageurl || senderAvatarUrl;
          senderAbout = sData.about || "";
          senderEmail = sData.email || "";
        }
      } catch (e) {
        console.warn("Could not fetch sender metadata for FCM:", e.message);
      }
    }

    const isCall = payload.type === "incoming_call";
    const notificationTitle = isCall ? (payload.title || "Incoming Call") : senderName;
    const notificationBody = payload.body || (isCall ? `${senderName} is calling...` : "Sent a message");

    const dataPayload = isCall
      ? {
          type: "incoming_call",
          callId: String(payload.callId || ""),
          callerId: String(payload.callerId || payload.senderId || ""),
          callerName: String(payload.callerName || senderName),
          callerImageUrl: String(payload.callerImageUrl || senderAvatarUrl),
          channelId: String(payload.channelId || ""),
          callType: String(payload.callType || "audio"),
          token: String(payload.token || ""),
          appId: String(payload.appId || ""),
        }
      : {
          type: String(payload.type || "chat_message"),
          conversationId: String(payload.conversationId || ""),
          messageId: String(payload.messageId || ""),
          senderId: String(payload.senderId || ""),
          senderName: String(senderName),
          senderAvatarUrl: String(senderAvatarUrl),
          senderAbout: String(senderAbout),
          senderEmail: String(senderEmail),
        };

    const multicastMessage = {
      tokens: fcmTokens,
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: dataPayload,
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: isCall ? "call_channel" : "high_importance_channel",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    };

    const response = await messaging.sendEachForMulticast(multicastMessage);
    console.info(`FCM multicast sent to ${userId}: ${response.successCount} succeeded, ${response.failureCount} failed out of ${fcmTokens.length} tokens.`);

    // Cleanup stale tokens if any failed with invalid token error
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(fcmTokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        console.info(`Cleaning up ${invalidTokens.length} expired FCM tokens for user ${userId}`);
        const validTokens = fcmTokens.filter((t) => !invalidTokens.includes(t));
        await db.collection("Users").doc(userId).update({ fcmToken: validTokens });
      }
    }

    return response.successCount > 0;
  } catch (error) {
    console.error(`Error sending FCM multicast to ${userId}:`, error);
    return false;
  }
};