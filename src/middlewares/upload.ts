import multer from "multer";
import { tmpdir } from "os";

export const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
