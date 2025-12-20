import jwt, { Secret, SignOptions } from "jsonwebtoken";

export interface JwtPayload {
  username: string;
  email: string;
}

const jwtSecret: Secret = process.env.JWT_SECRET || "default_secret";
const expiresIn: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES_IN ||
  "1d") as SignOptions["expiresIn"];

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, jwtSecret, { expiresIn });
};

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, jwtSecret);

    if (typeof decoded === "string") {
      return null;
    }

    return decoded as JwtPayload;
  } catch {
    return null;
  }
};
