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

export type FirebaseConnectionDiagnostic = {
  code:
    | 'FIREBASE_PROJECT_ID_MISSING'
    | 'WIF_ENV_INCOMPLETE'
    | 'OIDC_TOKEN_MISSING'
    | 'WIF_PROVIDER_REJECTED'
    | 'SERVICE_ACCOUNT_IMPERSONATION_DENIED'
    | 'FIRESTORE_PERMISSION_DENIED'
    | 'FIRESTORE_DATABASE_NOT_FOUND'
    | 'FIREBASE_AUTH_ERROR'
    | 'FIREBASE_UNKNOWN';
  message: string;
  expectedPrincipal?: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcSubject?: string;
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
      // Vercel Function의 현재 요청에 포함된 OIDC 토큰을 사용합니다.
      getSubjectToken: getVercelOidcToken,
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

function errorText(error: unknown) {
  if (error instanceof globalThis.Error) {
    const cause = 'cause' in error ? error.cause : undefined;
    return [error.name, error.message, cause instanceof globalThis.Error ? cause.message : '']
      .filter(Boolean)
      .join(' ');
  }
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.code, value.message, value.details]
      .filter(item => typeof item === 'string')
      .join(' ');
  }
  return 'unknown';
}

function decodeOidcClaims(token: string) {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iss?: unknown;
      aud?: unknown;
      sub?: unknown;
    };
    const audience = Array.isArray(claims.aud)
      ? claims.aud.map(String).join(', ')
      : typeof claims.aud === 'string'
        ? claims.aud
        : '';
    return {
      issuer: typeof claims.iss === 'string' ? claims.iss : '',
      audience,
      subject: typeof claims.sub === 'string' ? claims.sub : '',
    };
  } catch {
    return null;
  }
}

export async function diagnoseFirebaseConnection(error: unknown): Promise<FirebaseConnectionDiagnostic> {
  const message = errorText(error);
  const normalized = message.toLowerCase();
  const workloadIdentity = (() => {
    try {
      return workloadIdentityConfig();
    } catch {
      return null;
    }
  })();
  let oidcClaims: ReturnType<typeof decodeOidcClaims> = null;
  let oidcTokenError = '';

  if (workloadIdentity) {
    try {
      oidcClaims = decodeOidcClaims(await getVercelOidcToken());
    } catch (tokenError) {
      oidcTokenError = errorText(tokenError);
    }
  }

  const oidcDetails = oidcClaims
    ? {
        expectedPrincipal: oidcClaims.subject
          ? [
              '//iam.googleapis.com/projects',
              workloadIdentity?.projectNumber,
              'locations/global/workloadIdentityPools',
              workloadIdentity?.poolId,
              'subject',
              oidcClaims.subject,
            ].join('/').replace('//iam.googleapis.com', 'principal://iam.googleapis.com')
          : undefined,
        oidcIssuer: oidcClaims.issuer || undefined,
        oidcAudience: oidcClaims.audience || undefined,
        oidcSubject: oidcClaims.subject || undefined,
      }
    : {};

  if (normalized.includes('firebase_project_id')) {
    return {
      code: 'FIREBASE_PROJECT_ID_MISSING',
      message: 'Vercel Production 환경변수에 FIREBASE_PROJECT_ID를 등록한 뒤 다시 배포해 주세요.',
    };
  }
  if (normalized.includes('workload identity 환경변수가 누락')) {
    return {
      code: 'WIF_ENV_INCOMPLETE',
      message: 'Vercel Production의 GCP Workload Identity 환경변수 4개 중 일부가 누락되었습니다.',
    };
  }
  if (
    normalized.includes('x-vercel-oidc-token')
    || normalized.includes('vercel oidc token')
    || oidcTokenError.toLowerCase().includes('x-vercel-oidc-token')
  ) {
    return {
      code: 'OIDC_TOKEN_MISSING',
      message: '현재 Vercel Function 요청에 OIDC 토큰이 없습니다. 프로젝트 Security에서 OIDC Federation을 활성화하고 Production을 다시 배포해 주세요.',
    };
  }
  if (
    normalized.includes('invalid_grant')
    || normalized.includes('invalid_target')
    || normalized.includes('invalid audience')
    || normalized.includes('audience is not allowed')
    || normalized.includes('issuer')
    || normalized.includes('subject token')
  ) {
    return {
      code: 'WIF_PROVIDER_REJECTED',
      message: 'Google Cloud Workload Identity 공급업체가 Vercel 토큰을 거절했습니다. 공급업체의 Issuer URL, 허용 대상, 속성 매핑을 확인해 주세요.',
      ...oidcDetails,
    };
  }
  if (
    normalized.includes('iam.serviceaccounts.getaccesstoken')
    || normalized.includes('generateaccesstoken')
  ) {
    return {
      code: 'SERVICE_ACCOUNT_IMPERSONATION_DENIED',
      message: 'Vercel Production 주체에 서비스 계정의 Workload Identity User 권한이 없습니다. 아래 예상 주체를 서비스 계정 액세스 권한에 등록해 주세요.',
      ...oidcDetails,
    };
  }
  if (
    normalized.includes('datastore.entities')
    || normalized.includes('cloud datastore user')
    || (normalized.includes('permission_denied') && normalized.includes('firestore'))
    || (normalized.includes('permission denied') && normalized.includes('datastore'))
  ) {
    return {
      code: 'FIRESTORE_PERMISSION_DENIED',
      message: 'Vercel용 서비스 계정에 Firebase 프로젝트의 Cloud Datastore User 역할이 없습니다.',
      ...oidcDetails,
    };
  }
  if (
    normalized.includes('database') && (
      normalized.includes('not found')
      || normalized.includes('does not exist')
    )
  ) {
    return {
      code: 'FIRESTORE_DATABASE_NOT_FOUND',
      message: 'FIREBASE_PROJECT_ID가 Firestore 데이터베이스를 만든 프로젝트와 같은지 확인해 주세요.',
      ...oidcDetails,
    };
  }
  if (
    normalized.includes('unauthenticated')
    || normalized.includes('permission_denied')
    || normalized.includes('permission denied')
    || normalized.includes('credential')
    || normalized.includes('access token')
  ) {
    return {
      code: 'FIREBASE_AUTH_ERROR',
      message: 'Google Cloud 인증 또는 IAM 권한 확인이 필요합니다. Vercel 서버 로그의 leave_dashboard_load_failed 항목을 확인해 주세요.',
      ...oidcDetails,
    };
  }
  return {
    code: 'FIREBASE_UNKNOWN',
    message: 'Firestore 연결 중 분류되지 않은 오류가 발생했습니다. Vercel 서버 로그의 leave_dashboard_load_failed 항목을 확인해 주세요.',
    ...oidcDetails,
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
