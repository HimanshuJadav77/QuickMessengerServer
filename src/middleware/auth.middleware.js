import { auth } from "../config/firebase.js";
import errorMiddleware from "./error.middleware.js";

const authMiddleware = async (req, res, next) => {
    try {
        const authorization = req.headers.authorization;
        console.log("Authorization:", authorization);
        if (!authorization) {
            return res.status(401).json({
                success: false,
                message: "Authorization header is missing."
            });
        }
        if (!authorization.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Invalid Authorization Format."
            });
        }
        const idToken = authorization.split("Bearer ")[1];
        const decodedToken = await auth.verifyIdToken(idToken);

        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            email_verified: decodedToken.email_verified
        };
        next();

    } catch (error) {
        console.error(error);
        return res.status(401).json({
            success: false,
            message: "Invalid Or Expires Token."
        });
    }
};
export default authMiddleware;