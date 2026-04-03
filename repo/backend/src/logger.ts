import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  base: undefined,
  redact: {
    paths: [
      "password",
      "password_hash",
      "pin",
      "pin_hash",
      "sessionSecret",
      "session_secret",
      "sessionToken",
      "session_token",
      "phoneEncrypted",
      "phone_encrypted",
      "phone",
      "phone_last4",
      "governmentId",
      "government_id",
      "government_id_encrypted",
      "faceTemplateEncrypted",
      "averageHash",
      "average_hash",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.pin",
      "req.body.phone",
      "req.body.governmentId",
      "req.body.government_id"
    ],
    remove: true
  }
});
