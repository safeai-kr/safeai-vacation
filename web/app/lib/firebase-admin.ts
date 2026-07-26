import 'server-only';

import { getVercelOidcToken } from '@vercel/oidc';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type Credential,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ExternalAccountClient } from 'google-auth-library';

type WorkloadIdentityConfig = {
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
};

const WORKLOAD_IDENTITY_ENV = {
  projectNumber: 'GCP_PROJECT_NUMBER',
  serviceAccountEmail: 'GCP_SERVICE_ACCOUNT_EMAIL',
  poolId: 'GCP_WORKLOAD_IDENTITY_POOL_ID',
  providerId: 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
} as const;

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

function workloadIdentityConfig(): WorkloadIdentityConfig | null {
  const values: WorkloadIdentityConfig = {
    projectNumber: process.env.GCP_PROJECT_NUMBER?.trim() ?? '',
    serviceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() ?? '',
    poolId: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim() ?? '',
    providerId: process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim() ?? '',
  };
  const keys = Object.keys(values) as Array<keyof WorkloadIdentityConfig>;
  const configuredCount = keys.filter(key => values[key]).length;
  if (configuredCount === 0) return null;

  const missing = keys.filter(key => !values[key]).map(key => WORKLOAD_IDENTITY_ENV[key]);
  if (missing.length > 0) {
    throw new Error(`Vercel Workload Identity 환경변수가 누락되었습니다: ${missing.join(', ')}`);
  }

  if (!/^\d+$/.test(values.projectNumber)) {
    throw new Error('GCP_PROJECT_NUMBER는 숫자로 된 Google Cloud 프로젝트 번호여야 합니다.');
  }
  if (!values.serviceAccountEmail.endsWith('.iam.gserviceaccount.com')) {
    throw new Error('GCP_SERVICE_ACCOUNT_EMAIL 형식이 올바르지 않습니다.');
  }

  return values;
}

function workloadIdentityCredential(config: WorkloadIdentityConfig): Credential {
  const audience = [
    '//iam.googleapis.com/projects',
    config.projectNumber,
    'locations/global/workloadIdentityPools',
    config.poolId,
    'providers',
    config.providerId,
  ].join('/');
  const impersonationUrl = [
    'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts',
    `${config.serviceAccountEmail}:generateAccessToken`,
  ].join('/');
  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: impersonationUrl,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    subject_token_supplier: {
      // 요청마다 Vercel이 발급한 최신 OIDC 토큰을 사용합니다.
      getSubjectToken: () => getVercelOidcToken({ expirationBufferMs: 60_000 }),
    },
  });
  if (!authClient) {
    throw new Error('Vercel Workload Identity 인증 클라이언트를 생성하지 못했습니다.');
  }

  return {
    async getAccessToken() {
      const response = await authClient.getAccessToken();
      if (!response.token) {
        throw new Error('Vercel Workload Identity에서 Google 액세스 토큰을 받지 못했습니다.');
      }

      const expiryDate = authClient.credentials.expiry_date;
      const expiresIn = expiryDate
        ? Math.max(1, Math.floor((expiryDate - Date.now()) / 1000))
        : 3600;
      return {
        access_token: response.token,
        expires_in: expiresIn,
      };
    },
  };
}

export function firestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID가 설정되지 않았습니다.');
  const gcpProjectId = process.env.GCP_PROJECT_ID?.trim();
  if (gcpProjectId && gcpProjectId !== projectId) {
    throw new Error('FIREBASE_PROJECT_ID와 GCP_PROJECT_ID가 일치하지 않습니다.');
  }

  const serviceAccount = serviceAccountCredentials();
  const workloadIdentity = workloadIdentityConfig();
  const credential = serviceAccount
    ? cert(serviceAccount)
    : workloadIdentity
      ? workloadIdentityCredential(workloadIdentity)
      : applicationDefault();
  const app = getApps()[0] ?? initializeApp({
    projectId,
    credential,
  });
  return getFirestore(app);
}
