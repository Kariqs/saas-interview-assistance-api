import bcrypt from "bcryptjs";

export const encryptPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 12);
};

export const decryptPassword = async (
  password: string,
  encryptedPassword: string
): Promise<boolean> => {
  return await bcrypt.compare(password, encryptedPassword);
};
