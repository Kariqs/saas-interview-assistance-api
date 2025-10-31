import mongoose, { Schema, Document } from "mongoose";

export interface IUser {
  username: string;
  email: string;
  password: string;
  activationKey: string;
  accountActivated: boolean;
  passwordResetToken: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  activationKey: { type: String, required: false },
  accountActivated: { type: Boolean },
  passwordResetToken: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model<IUser>("User", userSchema);

export default User;
