import { db } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";

export class UsernameService {
  /**
   * Normalize username (lowercase, trim)
   */
  static normalize(username) {
    if (!username) return "";
    return username.trim().toLowerCase().replace(/^@/, "");
  }

  /**
   * Validate username rules:
   * - 3-20 characters
   * - Alphanumeric & underscores only
   * - Cannot be reserved words
   */
  static validate(username) {
    const normalized = this.normalize(username);
    if (!normalized || normalized.length < 3 || normalized.length > 20) {
      return { valid: false, message: "Username must be between 3 and 20 characters." };
    }

    const regex = /^[a-zA-Z0-9_]+$/;
    if (!regex.test(normalized)) {
      return { valid: false, message: "Username can only contain letters, numbers, and underscores." };
    }

    const reserved = ["admin", "administrator", "support", "help", "system", "quickmessenger", "fastshare", "official", "user"];
    if (reserved.includes(normalized)) {
      return { valid: false, message: "This username is reserved and unavailable." };
    }

    return { valid: true, normalized };
  }

  /**
   * Check if username is available (case-insensitive)
   */
  static async isAvailable(username) {
    const { valid, normalized, message } = this.validate(username);
    if (!valid) return { available: false, message };

    const doc = await db.collection("usernames").doc(normalized).get();
    if (doc.exists) {
      return { available: false, message: "Username is already taken." };
    }
    return { available: true, message: "Username is available." };
  }

  /**
   * Transactional atomic username update / reservation
   */
  static async updateUsername(userId, newUsername) {
    const { valid, normalized, message } = this.validate(newUsername);
    if (!valid) throw new Error(message);

    const userRef = db.collection("Users").doc(userId);
    const newUsernameRef = db.collection("usernames").doc(normalized);

    return await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) throw new Error("User profile not found");

      const oldUsername = userDoc.data().usernameNormalized || this.normalize(userDoc.data().username || "");

      if (oldUsername === normalized) {
        return { success: true, username: newUsername, usernameNormalized: normalized };
      }

      const targetUsernameDoc = await transaction.get(newUsernameRef);
      if (targetUsernameDoc.exists) {
        throw new Error("Username is already taken by another user.");
      }

      // Reserve new username lock
      transaction.set(newUsernameRef, {
        uid: userId,
        username: newUsername,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Release old username lock if existing
      if (oldUsername) {
        const oldRef = db.collection("usernames").doc(oldUsername);
        transaction.delete(oldRef);
      }

      // Update user doc
      transaction.update(userRef, {
        username: newUsername,
        usernameNormalized: normalized,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { success: true, username: newUsername, usernameNormalized: normalized };
    });
  }
}

export default UsernameService;
