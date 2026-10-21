'use client'

import { ApiError } from './api'
import { loadRuntimeConfig } from './config'

/**
 * Staff accounts live in Cognito. The browser talks to it directly, from the site's own sign-in and
 * sign-up pages: no hosted login page, so no HTTPS redirect URL is needed.
 *
 * Two calls are all the site needs, so this speaks Cognito's JSON API with `fetch` instead of
 * pulling in an SDK. Sign-in uses the USER_PASSWORD_AUTH flow: the password travels over TLS to
 * Cognito, as it used to travel to the Java backend. New accounts are confirmed on creation by the
 * pre sign-up trigger, so there is no verification-code step.
 *
 * Cognito's errors are translated to the same codes the API used, so the pages need no new cases.
 */

interface CognitoFailure {
  __type?: string
  message?: string
}

const ERRORS: Record<string, { status: number; code: string }> = {
  UsernameExistsException: { status: 409, code: 'EMAIL_TAKEN' },
  // Wrong password and unknown email answer the same on purpose: nobody can probe for accounts.
  NotAuthorizedException: { status: 401, code: 'BAD_CREDENTIALS' },
  UserNotFoundException: { status: 401, code: 'BAD_CREDENTIALS' },
  InvalidPasswordException: { status: 400, code: 'WEAK_PASSWORD' },
  InvalidParameterException: { status: 400, code: 'VALIDATION_FAILED' },
  TooManyRequestsException: { status: 429, code: 'TOO_MANY_REQUESTS' },
  LimitExceededException: { status: 429, code: 'TOO_MANY_REQUESTS' },
}

async function call<T>(operation: 'SignUp' | 'InitiateAuth', body: Record<string, unknown>): Promise<T> {
  const config = await loadRuntimeConfig()
  let response: Response
  try {
    response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify({ ClientId: config.userPoolClientId, ...body }),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.")
  }

  const payload = (await response.json().catch(() => ({}))) as T & CognitoFailure
  if (!response.ok) {
    // `__type` sometimes carries a namespace prefix: keep only the exception name.
    const type = (payload.__type ?? '').split('#').pop() ?? ''
    const known = ERRORS[type]
    throw new ApiError(known?.status ?? response.status, known?.code ?? 'UNKNOWN', payload.message ?? 'Sign-in failed.')
  }
  return payload
}

export async function signUp(input: { email: string; password: string; displayName: string }): Promise<void> {
  await call('SignUp', {
    Username: input.email,
    Password: input.password,
    UserAttributes: [
      { Name: 'email', Value: input.email },
      { Name: 'name', Value: input.displayName },
    ],
  })
}

/** Returns the ID token: the one API Gateway's Cognito authorizer validates. */
export async function signIn(email: string, password: string): Promise<string> {
  const result = await call<{ AuthenticationResult?: { IdToken?: string } }>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
  })
  const token = result.AuthenticationResult?.IdToken
  if (!token) throw new ApiError(401, 'BAD_CREDENTIALS', 'Sign-in did not return a session.')
  return token
}
