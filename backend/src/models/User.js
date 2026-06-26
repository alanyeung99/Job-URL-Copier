import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    googleSub: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
