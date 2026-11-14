'use client'

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { ApiError } from './api'
import { loadRuntimeConfig } from './config'

/**
 * Staff accounts live in Cognito. The browser talks to it directly, from the site's own sign-in and
 * sign-up pages: no hosted login page, so no HTTPS redirect URL is needed.
 *
 * - Sign-in uses SRP (Secure Remote Password): the browser proves it knows the password without
 *   ever sending it, so not even Cognito receives it.
 * - New accounts must confirm their email with a code Cognito sends before they can sign in.
 * - ID tokens last an hour. `currentIdToken` renews them with the refresh token, which lasts one
 *   shift, so the panel never asks for the password again in the middle of a shift.
 *
 * The library keeps the tokens in `localStorage`. Cognito's errors are translated to the same codes
 * the API uses, so the pages show them like any other error.
 */

const ERRORS: Record<string, { status: number; code: string }> = {
  UsernameExistsException: { status: 409, code: 'EMAIL_TAKEN' },
  // Wrong password and unknown email answer the same on purpose: nobody can probe for accounts.
  NotAuthorizedException: { status: 401, code: 'BAD_CREDENTIALS' },
  UserNotFoundException: { status: 401, code: 'BAD_CREDENTIALS' },
  UserNotConfirmedException: { status: 403, code: 'ACCOUNT_NOT_CONFIRMED' },
  CodeMismatchException: { status: 400, code: 'INVALID_CODE' },
  ExpiredCodeException: { status: 400, code: 'CODE_EXPIRED' },
  InvalidPasswordException: { status: 400, code: 'WEAK_PASSWORD' },
  InvalidParameterException: { status: 400, code: 'VALIDATION_FAILED' },
  TooManyRequestsException: { status: 429, code: 'TOO_MANY_REQUESTS' },
  TooManyFailedAttemptsException: { status: 429, code: 'TOO_MANY_REQUESTS' },
  LimitExceededException: { status: 429, code: 'TOO_MANY_REQUESTS' },
  CodeDeliveryFailureException: { status: 503, code: 'CODE_NOT_SENT' },
}

function toApiError(cause: unknown): ApiError {
  const error = cause as { code?: string; name?: string; message?: string } | null
  const known = ERRORS[error?.code ?? error?.name ?? '']
  if (known) return new ApiError(known.status, known.code, error?.message ?? '')
  if (error?.code === 'NetworkError' || error?.name === 'NetworkError') {
    return new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.")
  }
  return new ApiError(0, 'UNKNOWN', error?.message ?? 'Sign-in failed.')
}

let pool: CognitoUserPool | null = null

async function userPool(): Promise<CognitoUserPool> {
  if (!pool) {
    const config = await loadRuntimeConfig()
    pool = new CognitoUserPool({ UserPoolId: config.userPoolId, ClientId: config.userPoolClientId })
  }
  return pool
}

async function user(email: string): Promise<CognitoUser> {
  return new CognitoUser({ Username: email, Pool: await userPool() })
}

/** Creates the account. Cognito emails a code that `confirmSignUp` checks. */
export async function signUp(input: { email: string; password: string; displayName: string }): Promise<void> {
  const users = await userPool()
  await new Promise<void>((resolve, reject) =>
    users.signUp(
      input.email,
      input.password,
      [
        new CognitoUserAttribute({ Name: 'email', Value: input.email }),
        new CognitoUserAttribute({ Name: 'name', Value: input.displayName }),
      ],
      [],
      (error) => (error ? reject(toApiError(error)) : resolve()),
    ),
  )
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const account = await user(email)
  await new Promise<void>((resolve, reject) =>
    account.confirmRegistration(code, true, (error) => (error ? reject(toApiError(error)) : resolve())),
  )
}

export async function resendCode(email: string): Promise<void> {
  const account = await user(email)
  await new Promise<void>((resolve, reject) =>
    account.resendConfirmationCode((error) => (error ? reject(toApiError(error)) : resolve())),
  )
}

/** SRP sign-in. Returns the ID token: the one API Gateway's Cognito authorizer validates. */
export async function signIn(email: string, password: string): Promise<string> {
  const account = await user(email)
  const session = await new Promise<CognitoUserSession>((resolve, reject) =>
    account.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: resolve,
      onFailure: (error) => reject(toApiError(error)),
    }),
  )
  return session.getIdToken().getJwtToken()
}

/**
 * The ID token of the signed-in user, renewed with the refresh token if it expired; null when nobody
 * is signed in or the session can no longer be renewed (the refresh token expired too).
 */
export async function currentIdToken(): Promise<string | null> {
  const signedIn = (await userPool()).getCurrentUser()
  if (!signedIn) return null
  return new Promise((resolve) =>
    signedIn.getSession((error: Error | null, session: CognitoUserSession | null) =>
      resolve(error || !session?.isValid() ? null : session.getIdToken().getJwtToken()),
    ),
  )
}

/** Forgets the session in this browser: the stored tokens are deleted. */
export async function signOut(): Promise<void> {
  ;(await userPool()).getCurrentUser()?.signOut()
}
