import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  base: undefined,
  redact: {
    paths: [
      "password",
      "pin",
      "sessionSecret",
      "phoneEncrypted",
      "faceTemplateEncrypted",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.pin"
    ],
    remove: true
  }
});

