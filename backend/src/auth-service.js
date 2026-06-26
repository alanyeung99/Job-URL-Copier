import { verifyGoogleAccessToken } from './google-token.js';
import { User } from './models/User.js';
import { signPlatformToken } from './platform-auth.js';
import { getUserSettings } from './settings-service.js';

export async function createPlatformSessionFromGoogleAccessToken(accessToken) {
  const googleUser = await verifyGoogleAccessToken(accessToken);
  if (!googleUser.email) {
    throw new Error(
      'Could not read Google account email. Sign in again and allow email access when prompted.'
    );
  }

  const user = await User.findOneAndUpdate(
    { googleSub: googleUser.googleSub },
    { email: googleUser.email },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Platform user registered: ${user.email} (${user._id})`);

  const token = signPlatformToken(user);
  const settings = await getUserSettings(user._id);

  return {
    token,
    user: {
      id: String(user._id),
      email: user.email,
      googleSub: user.googleSub
    },
    settings
  };
}
