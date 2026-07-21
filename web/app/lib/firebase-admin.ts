import 'server-only';

import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function serviceAccountCredentials(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ServiceAccount & { private_key?: string };
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.');
  }
}

export function firestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID가 설정되지 않았습니다.');
  const serviceAccount = serviceAccountCredentials();
  const app = getApps()[0] ?? initializeApp({
    projectId,
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
  });
  return getFirestore(app);
}
